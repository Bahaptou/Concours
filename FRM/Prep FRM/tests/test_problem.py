"""Tests de la conversion des erreurs en « problem details » (RFC 9457).

C'est l'unique endroit qui décide du code HTTP d'une erreur : on vérifie qu'il choisit la
correspondance la plus précise, qu'il ne laisse jamais fuiter un message interne, et qu'il
ajoute les champs propres à chaque erreur.
"""
from http import HTTPStatus

from backend.errors import (
    AppError,
    InvalidRequestError,
    PayloadTooLargeError,
    RouteNotFoundError,
    StorageError,
    TypstCompileError,
)
from backend.http.problem import ErrorTitle, build_problem_details, find_mapping


def test_la_sous_classe_la_plus_precise_gagne_quel_que_soit_l_ordre_de_la_table():
    # PayloadTooLargeError hérite d'InvalidRequestError, et les deux sont dans la table.
    # La recherche suit l'héritage (MRO) : on doit obtenir 413, pas le 422 du parent.
    mapping = find_mapping(PayloadTooLargeError(2_000_000, 1_000_000))
    assert mapping.status == HTTPStatus.REQUEST_ENTITY_TOO_LARGE
    assert mapping.title == ErrorTitle.PAYLOAD_TOO_LARGE


def test_une_sous_classe_absente_de_la_table_herite_de_son_parent():
    # RouteNotFoundError n'est pas dans la table, mais son parent NotFoundError y est.
    problem = build_problem_details(RouteNotFoundError("GET", "/api/inconnu"), "/api/inconnu")
    assert problem.status == 404
    assert problem.title == ErrorTitle.NOT_FOUND
    # Le message humain vient de __str__ de l'exception, puisque la table ne fixe pas de détail.
    assert "/api/inconnu" in problem.detail


def test_une_exception_inattendue_donne_un_500_generique_sans_fuite():
    # Une erreur qui n'est pas une AppError (bug, KeyError…) : on renvoie un message neutre,
    # jamais le texte interne de l'exception.
    problem = build_problem_details(KeyError("secret interne"), "/api/compile")
    assert problem.status == 500
    assert problem.title == ErrorTitle.INTERNAL_SERVER_ERROR
    assert "secret" not in problem.detail


def test_une_app_error_sans_correspondance_donne_aussi_un_500():
    # Une erreur métier oubliée dans la table ne doit pas planter : elle retombe sur le 500.
    class ErreurOubliee(AppError):
        pass

    assert build_problem_details(ErreurOubliee(), "/api").status == 500


def test_l_erreur_de_stockage_ne_montre_pas_le_chemin_disque():
    # StorageError a un détail fixe dans la table : le chemin et la raison restent dans les journaux.
    problem = build_problem_details(StorageError("C:/secret/fiche.typ", "disque plein"), "/api/notes/1/a")
    assert problem.status == 500
    assert "C:/secret" not in problem.detail


def test_l_erreur_typst_porte_ses_champs_d_extension():
    # L'éditeur a besoin de la ligne, des indices et de l'explication pour son bandeau d'erreur.
    error = TypstCompileError("unknown variable: sigmaa", ["essaie s i g m a a"], "Nom inconnu.", line=4, saved=True)
    problem = build_problem_details(error, "/api/compile").to_dict()
    assert problem["status"] == 422
    assert problem["title"] == ErrorTitle.TYPST_COMPILE_ERROR
    assert problem["detail"] == "unknown variable: sigmaa"
    assert problem["line"] == 4
    assert problem["hints"] == ["essaie s i g m a a"]
    assert problem["saved"] is True
    # Les membres standard de la RFC sont toujours présents.
    assert {"type", "status", "title", "detail", "instance"} <= problem.keys()


def test_l_erreur_de_requete_indique_le_champ_fautif():
    problem = build_problem_details(InvalidRequestError("reading", "entier attendu"), "/api/notes/x/a").to_dict()
    assert problem["status"] == 422
    assert problem["field"] == "reading"


def test_aucune_extension_n_utilise_un_nom_reserve_par_la_rfc():
    # Une extension nommée « status » ou « title » écraserait un membre standard.
    # On instancie chaque erreur connue et on vérifie ses noms d'extensions.
    from backend.http.problem import RESERVED_MEMBERS

    exemples = [
        InvalidRequestError("x", "y"),
        PayloadTooLargeError(2, 1),
        RouteNotFoundError("GET", "/api/x"),
        TypstCompileError("m", [], None, None),
        StorageError("p", "r"),
    ]
    for erreur in exemples:
        assert not (erreur.extensions().keys() & RESERVED_MEMBERS), type(erreur).__name__


def test_un_membre_standard_l_emporte_sur_une_extension_homonyme():
    # Filet de sécurité : même si une future erreur se trompait de nom, le statut reste le bon.
    class ErreurMalNommee(InvalidRequestError):
        def extensions(self):
            return {"status": 200, "title": "FAUX"}

    problem = build_problem_details(ErreurMalNommee("x", "y"), "/api").to_dict()
    assert problem["status"] == 422
    assert problem["title"] == ErrorTitle.INVALID_REQUEST_PAYLOAD
