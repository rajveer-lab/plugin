"""Pre- and post-generation guardrails."""

from importlib import import_module

_EXPORTS = {
    "AmbiguityFlag": ".prompt_grounder",
    "AmbiguityType": ".prompt_grounder",
    "GroundedPrompt": ".prompt_grounder",
    "HallucinationMitigator": ".mitigator",
    "MitigationAction": ".mitigator",
    "MitigationPolicy": ".mitigator",
    "MitigationResult": ".mitigator",
    "SentenceMitigation": ".mitigator",
    "PromptAssessment": ".prompt_grounder",
    "PromptGrounder": ".prompt_grounder",
    "Strictness": ".prompt_grounder",
}

__all__ = sorted(_EXPORTS)


def __getattr__(name):
    # Imported lazily so `python -m src.guardrails.prompt_grounder` doesn't load the module twice
    if name in _EXPORTS:
        return getattr(import_module(_EXPORTS[name], __name__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
