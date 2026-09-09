"""One profile, one source of truth: Postgres.

The visual picker used to write `profiles.configuration` while the workflows
read a static `/files/config/user_profile.json` nobody kept in step, so what the
user chose never reached Laboral, Noticias or Marca Personal. These tests pin
the replacement: `/api/profiles/runtime` derives the runtime profile from the
stored one, and the values a user picks are the values a workflow receives.

The recognisable fixture below is used throughout - Lleida, Aeroespacial, two
interests, two news categories, two brand topics - so a default leaking through
instead of a real choice is obvious rather than plausible.
"""
from __future__ import annotations

import json

import pytest

from app.services import profile_runtime as runtime

# Deliberately distinctive: none of these is a default the old code would emit.
PICKED = {
    "formacion": ["ingenieria_aeroespacial"],
    "sector": ["aeroespacial", "defensa"],
    "objetivo_profesional": ["graduate_program"],
    "ubicacion": ["lleida"],
    "modalidad": ["hibrido"],
    "experiencia_nivel": ["junior"],
    "idioma": "ca",
    "intereses": ["robotica", "ciberseguridad"],
    "preferencias_laborales": {
        "salario_minimo": "30k",
        "tipo_empresa": ["startup"],
        "tipo_contrato": ["practicas"],
        "proyeccion": ["internacional"],
    },
    "preferencias_noticias": {"categorias": ["aeroespacial", "aviacion"], "frecuencia": "diario"},
    "marca_personal": {"temas": ["inteligencia_artificial", "aeroespacial"], "objetivos": ["linkedin"]},
    "automatizaciones": {"laboral": True, "noticias": True},
}

#: what the workflows used to hard-code when the file was missing
OLD_DEFAULTS = {
    "keywords": "Engineer,Analyst,Operations",
    "location": "Barcelona",
    "perfil_texto": "ingeniería",
    "idioma": "es",
}


def register(client, *, username="owner", email="owner@example.com") -> str:
    r = client.post("/api/auth/register", json={
        "email": email, "username": username, "password": "Correct-Horse-9"})
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create_profile(client, token, *, name="Mi perfil", configuration=None):
    r = client.post("/api/profiles", headers=auth(token), json={
        "name": name,
        "configuration": PICKED if configuration is None else configuration,
        "make_primary": True})
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------ 1 & 2. save and read back --


def test_a_visual_profile_is_stored_in_postgres(client, db_session):
    from app.models import Profile

    token = register(client)
    created = create_profile(client, token)

    row = db_session.get(Profile, __import__("uuid").UUID(created["id"]))
    assert row is not None
    assert row.configuration["ubicacion"] == ["lleida"]
    assert row.configuration["sector"] == ["aeroespacial", "defensa"]


def test_reading_it_back_returns_exactly_what_was_picked(client):
    token = register(client)
    created = create_profile(client, token)

    stored = client.get(f"/api/profiles/{created['id']}", headers=auth(token)).json()
    for key, value in PICKED.items():
        assert stored["configuration"][key] == value, key


# ------------------------------------------- 3. transform into runtime shape --


def test_the_runtime_profile_is_derived_from_the_stored_one(client):
    token = register(client)
    create_profile(client, token)

    body = client.get("/api/profiles/runtime", headers=auth(token)).json()
    profile = body["profile"]

    assert profile["idioma"] == "ca"
    assert profile["location"] == "Lleida"
    assert profile["modalidad"] == "Híbrido"
    assert profile["nivel"] == "Junior"


# --------------------------------- 4, 5, 6. each automation gets real values --


def test_laboral_receives_the_picked_values_not_the_old_defaults(client):
    token = register(client)
    create_profile(client, token)
    profile = client.get("/api/profiles/runtime", headers=auth(token)).json()["profile"]

    assert profile["keywords"] != OLD_DEFAULTS["keywords"]
    assert "Aeroespacial" in profile["keywords"]
    assert profile["location"] == "Lleida" != OLD_DEFAULTS["location"]
    assert "aeroespacial" in profile["include_terms"]
    assert "robotica" in profile["include_terms"], "interests must feed scoring"
    assert "Aeroespacial" in profile["perfil_texto"]
    assert profile["preferencias_laborales"]["tipo_empresa"] == ["Startup"]


def test_noticias_receives_the_picked_categories_not_the_old_defaults(client):
    token = register(client)
    create_profile(client, token)
    profile = client.get("/api/profiles/runtime", headers=auth(token)).json()["profile"]

    assert profile["categorias"] == ["Aeroespacial", "Aviación"]
    assert "Aeroespacial" in profile["feed_url"]
    # the locale follows the picked language, not a hard-coded Spanish one
    assert "hl=ca" in profile["feed_url"]
    assert "econom" not in profile["feed_url"], "that is the no-profile fallback query"
    assert profile["max_palabras"] == runtime.NEWS_WORDS


def test_marca_personal_receives_the_picked_topics_not_the_old_defaults(client):
    token = register(client)
    create_profile(client, token)
    profile = client.get("/api/profiles/runtime", headers=auth(token)).json()["profile"]

    assert profile["temas"] == "IA, Aeroespacial"
    assert profile["tono"] == runtime.TONE_BY_OBJECTIVE["linkedin"]
    assert profile["tono"] != runtime.DEFAULT_TONE
    # the brand feeds start with the user's own news query
    assert profile["feeds"][0] == profile["feed_url"]
    assert len(profile["feeds"]) == 1 + len(runtime.EXTRA_BRAND_FEEDS)


# ------------------------------------------------- 7. Agenda compatibility --


def test_agenda_still_gets_the_language_it_reads(client):
    """Agenda only ever needed `idioma`; that contract must not move."""
    token = register(client)
    create_profile(client, token)
    profile = client.get("/api/profiles/runtime", headers=auth(token)).json()["profile"]

    assert profile["idioma"] == "ca"
    assert profile["idioma"] in runtime.LOCALES


def test_a_profile_with_nothing_picked_still_yields_a_usable_shape(client):
    """A half-filled profile must not break a workflow mid-run."""
    token = register(client)
    create_profile(client, token, configuration={})
    profile = client.get("/api/profiles/runtime", headers=auth(token)).json()["profile"]

    assert profile["idioma"] == runtime.DEFAULT_LANGUAGE
    assert profile["keywords"] == OLD_DEFAULTS["keywords"]
    assert profile["feed_url"].startswith("https://news.google.com/")


# ------------------------------------- 8. two profiles, two configurations --


def test_two_profiles_produce_different_runtime_configurations(client):
    token = register(client)
    first = create_profile(client, token, name="Aeroespacial")
    second = create_profile(client, token, name="Software", configuration={
        "sector": ["software"], "ubicacion": ["madrid"], "idioma": "en",
        "intereses": ["machine_learning"],
        "preferencias_noticias": {"categorias": ["tecnologia"]},
    })

    a = client.get(f"/api/profiles/runtime?profile_id={first['id']}", headers=auth(token)).json()
    b = client.get(f"/api/profiles/runtime?profile_id={second['id']}", headers=auth(token)).json()

    assert a["profile"]["location"] == "Lleida"
    assert b["profile"]["location"] == "Madrid"
    assert a["profile"]["idioma"] == "ca" and b["profile"]["idioma"] == "en"
    assert a["profile"]["feed_url"] != b["profile"]["feed_url"]
    assert a["profile"]["keywords"] != b["profile"]["keywords"]


# ------------------------------------------------- 9. tenant isolation ------


def test_a_user_cannot_read_another_users_profile(client):
    owner = register(client)
    mine = create_profile(client, owner)

    intruder = register(client, username="intruder", email="intruder@example.com")
    create_profile(client, intruder, name="Suyo", configuration={"ubicacion": ["madrid"]})

    r = client.get(f"/api/profiles/runtime?profile_id={mine['id']}", headers=auth(intruder))
    assert r.status_code == 404, "another tenant's profile must not be readable"

    # and the intruder's own runtime profile is their own data, not the owner's
    theirs = client.get("/api/profiles/runtime", headers=auth(intruder)).json()
    assert theirs["profile"]["location"] == "Madrid"


def test_the_runtime_profile_needs_a_caller(client):
    register(client)
    assert client.get("/api/profiles/runtime").status_code == 401


def test_an_automation_must_name_the_profile_it_wants(client):
    """The service token belongs to the installation, not to a person."""
    token = register(client)
    created = create_profile(client, token)
    service_token = client.post("/api/ai/service-token", headers=auth(token)).json()["token"]

    blind = client.get("/api/profiles/runtime", headers={"X-AC-Service-Token": service_token})
    assert blind.status_code == 400, "it must not be allowed to mean 'whoever is first'"

    named = client.get(
        f"/api/profiles/runtime?profile_id={created['id']}",
        headers={"X-AC-Service-Token": service_token},
    )
    assert named.status_code == 200
    assert named.json()["profile"]["location"] == "Lleida"


def test_an_unset_ac_profile_id_gets_the_message_that_explains_it(client):
    """n8n builds the URL from $env.AC_PROFILE_ID; unset means `?profile_id=`.

    An empty value is not an absent one for FastAPI, so this used to die at
    validation with a 422 about UUID lengths - which tells the operator
    nothing. It must reach the same 400 as a missing parameter, and the rule
    itself must not soften: naming a profile is still required.
    """
    token = register(client)
    create_profile(client, token)
    service_token = client.post("/api/ai/service-token", headers=auth(token)).json()["token"]

    empty = client.get(
        "/api/profiles/runtime?profile_id=",
        headers={"X-AC-Service-Token": service_token},
    )
    assert empty.status_code == 400, "an empty AC_PROFILE_ID must not look like a parse error"
    assert "AC_PROFILE_ID" in empty.json()["detail"], "the message must name the variable to set"

    # A value that is present but not a UUID is still refused.
    junk = client.get(
        "/api/profiles/runtime?profile_id=not-a-uuid",
        headers={"X-AC-Service-Token": service_token},
    )
    assert junk.status_code == 422


def test_a_wrong_service_token_is_refused(client):
    token = register(client)
    created = create_profile(client, token)
    r = client.get(
        f"/api/profiles/runtime?profile_id={created['id']}",
        headers={"X-AC-Service-Token": "acs_not-the-right-one"},
    )
    assert r.status_code == 401


# --------------------------------- 10. unknown / legacy values are kept ------


def test_unknown_and_legacy_values_are_never_destroyed(client):
    legacy = {
        **PICKED,
        "sector": ["aeroespacial", "un_sector_que_ya_no_existe"],
        "campo_de_una_version_antigua": {"algo": [1, 2, 3]},
    }
    token = register(client)
    create_profile(client, token, configuration=legacy)

    body = client.get("/api/profiles/runtime", headers=auth(token)).json()
    # an id the catalogue no longer knows survives as itself
    assert "un_sector_que_ya_no_existe" in body["profile"]["keywords"]
    # and anything outside the derived shape is handed back verbatim
    assert body["profile"]["raw"]["campo_de_una_version_antigua"] == {"algo": [1, 2, 3]}

    stored = client.get("/api/profiles", headers=auth(token)).json()[0]
    assert stored["configuration"]["campo_de_una_version_antigua"] == {"algo": [1, 2, 3]}


def test_editing_one_dimension_does_not_drop_the_others(client):
    token = register(client)
    created = create_profile(client, token)

    client.patch(f"/api/profiles/{created['id']}", headers=auth(token),
                 json={"configuration": {**PICKED, "ubicacion": ["madrid"]}})

    profile = client.get("/api/profiles/runtime", headers=auth(token)).json()["profile"]
    assert profile["location"] == "Madrid"
    assert profile["idioma"] == "ca", "an unrelated dimension must survive the edit"
    assert "Aeroespacial" in profile["temas"] or profile["categorias"]


# --------------------------------------------- 11. no secrets anywhere -------


def test_the_runtime_profile_carries_no_secret(client, caplog):
    token = register(client)
    created = create_profile(client, token)
    service_token = client.post("/api/ai/service-token", headers=auth(token)).json()["token"]

    with caplog.at_level("DEBUG"):
        body = client.get(
            f"/api/profiles/runtime?profile_id={created['id']}",
            headers={"X-AC-Service-Token": service_token},
        ).text

    for needle in (service_token, "nvapi-", "sk-or-", "AIza"):
        assert needle not in body
    assert service_token not in caplog.text


# ------------------------------------------------------- the mapper itself ---


@pytest.mark.parametrize("configuration", [None, {}, {"sector": "aeroespacial"}, {"ubicacion": None}])
def test_the_mapper_never_raises_on_a_malformed_profile(configuration):
    out = runtime.build(configuration)
    assert out["idioma"] == runtime.DEFAULT_LANGUAGE
    assert isinstance(out["include_terms"], list)


def test_the_mapper_uses_the_catalogue_and_not_a_second_taxonomy():
    """Every derived label must come from the picker's own catalogue."""
    from app.services import profile_catalog as catalog

    sector_labels = {o.label for o in catalog.field_at(("sector",)).options}
    out = runtime.build({"sector": ["aeroespacial"]})
    assert set(out["keywords"].split(",")) <= sector_labels


def test_a_new_catalogue_option_needs_no_change_here():
    """Adding an option to the catalogue makes it usable straight away."""
    from app.services import profile_catalog as catalog

    option = catalog.field_at(("intereses",)).options[-1]
    out = runtime.build({"intereses": [option.id]})
    assert runtime._fold(option.label) in out["include_terms"]


def test_json_serialisable(client):
    """n8n reads this over HTTP; it has to survive a JSON round trip."""
    token = register(client)
    create_profile(client, token)
    body = client.get("/api/profiles/runtime", headers=auth(token)).json()
    assert json.loads(json.dumps(body)) == body
