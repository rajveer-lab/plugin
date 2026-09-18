"""Retrieval connectors that supply reference evidence."""

from importlib import import_module

_EXPORTS = {
    "BraveSearchBackend": ".search_retriever",
    "EvidencePassage": ".search_retriever",
    "InMemoryBackend": ".search_retriever",
    "LocalDocumentBackend": ".search_retriever",
    "RetrievalBackend": ".search_retriever",
    "SearchRetriever": ".search_retriever",
}

__all__ = sorted(_EXPORTS)


def __getattr__(name):
    # Imported lazily so `python -m src.connectors.search_retriever` doesn't load the module twice
    if name in _EXPORTS:
        return getattr(import_module(_EXPORTS[name], __name__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
