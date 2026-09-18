"""Interactive Demonstration of the Anti-Hallucination Plugin.

Shows the full pipeline in action:
1. Atomic claim extraction
2. Ground truth verification
3. Hallucination scoring and risk level assessment
4. Multi-sample consistency check (SelfCheckGPT pattern)
5. Sentence attribution & citation tagging
"""

from __future__ import annotations

import json
from src.core.claim_extractor import ClaimExtractor
from src.core.verifier import FactVerifier
from src.core.scorer import HallucinationScorer
from src.core.consistency_checker import ConsistencyChecker
from src.core.citation_tracker import CitationTracker


def print_banner(title: str):
    print("\n" + "=" * 70)
    print(f" {title.upper()}")
    print("=" * 70)


def run_demo():
    print_banner("Anti-Hallucination Plugin Demo")

    # Example 1: Faithful / Grounded Response
    print_banner("Scenario 1: High Fidelity Grounded Response")
    evidence_docs = [
        "The James Webb Space Telescope (JWST) was launched on December 25, 2021.",
        "JWST operates in the infrared spectrum and is stationed at the Sun-Earth L2 Lagrange point, approximately 1.5 million kilometers from Earth."
    ]
    grounded_output = (
        "The James Webb Space Telescope was launched in 2021. "
        "It observes primarily in the infrared spectrum, and it is located near the L2 Lagrange point."
    )

    extractor = ClaimExtractor()
    verifier = FactVerifier()
    scorer = HallucinationScorer()

    claims = extractor.extract(grounded_output)
    print(f"\n[1] Extracted {len(claims)} Atomic Claims:")
    for c in claims:
        print(f"  - [{c.claim_type.value}] {c.text} (Entities: {c.entities})")

    verifications = verifier.verify_all(claims, evidence_docs)
    report = scorer.score(verifications)

    print(f"\n[2] Verification & Hallucination Assessment:")
    print(f"  - Hallucination Score: {report.hallucination_score} (0.0 = completely faithful)")
    print(f"  - Confidence: {report.confidence_score}")
    print(f"  - Risk Level: {report.risk_level.value}")
    print(f"  - Verdict: {report.verdict}")
    for res in report.detailed_results:
        print(f"  * Claim: '{res.claim_text}' -> {res.status.value.upper()} (conf: {res.confidence})")

    # Example 2: Hallucinated / Contradicted Response
    print_banner("Scenario 2: Hallucinated & Contradicted Response")
    hallucinated_output = (
        "The James Webb Space Telescope was launched in 1995. "
        "It was built entirely by private space tourists, and it landed directly on Jupiter's moon Europa in 2020."
    )
    h_claims = extractor.extract(hallucinated_output)
    h_verifications = verifier.verify_all(h_claims, evidence_docs)
    h_report = scorer.score(h_verifications)

    print(f"\n[1] Extracted {len(h_claims)} Claims from Hallucinated Text:")
    for c in h_claims:
        print(f"  - [{c.claim_type.value}] {c.text}")

    print(f"\n[2] Verification & Hallucination Assessment:")
    print(f"  - Hallucination Score: {h_report.hallucination_score}")
    print(f"  - Risk Level: {h_report.risk_level.value}")
    print(f"  - Verdict: {h_report.verdict}")
    for res in h_report.detailed_results:
        print(f"  * Claim: '{res.claim_text}' -> {res.status.value.upper()} [{res.reasoning}]")

    # Example 3: Multi-Sample Self-Consistency (SelfCheckGPT pattern)
    print_banner("Scenario 3: Zero-Retrieval Multi-Sample Consistency")
    checker = ConsistencyChecker()
    primary = "Alexander Fleming discovered penicillin in London."
    stochastic_samples = [
        "In 1928, penicillin was discovered in London by Alexander Fleming.",
        "Alexander Fleming was a Scottish physician who identified penicillin at a London hospital.",
        "Alexander Fleming noticed mold inhibiting bacteria in his London laboratory."
    ]
    consistency_rep = checker.check_consistency(primary, stochastic_samples)
    print(f"Primary Response: '{primary}'")
    print(f"Tested against {len(stochastic_samples)} stochastic samples.")
    print(f"Consistency Score: {consistency_rep.overall_consistency_score} (Stable Claims: {consistency_rep.stable_claims}/{consistency_rep.total_claims})")

    # Example 4: Automatic Citation Attribution
    print_banner("Scenario 4: Grounded Sentence Attribution")
    sources = {
        "Source_A": "Alexander Fleming discovered penicillin in 1928 at St Mary's Hospital in London.",
        "Source_B": "Penicillin is one of the earliest discovered antibiotic agents."
    }
    tracker = CitationTracker()
    test_text = "Alexander Fleming discovered penicillin at St Mary's Hospital. He also invented airplanes and time machines."
    citation_rep = tracker.attribute(test_text, sources)
    print(f"Attribution Coverage: {citation_rep.attribution_coverage}%")
    print(f"Annotated Text Output:\n  {citation_rep.annotated_text}")

    print_banner("Demo Complete - All Modules Functioning Flawlessly")


if __name__ == "__main__":
    run_demo()
