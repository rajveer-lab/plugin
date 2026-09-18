"""End-to-End Integration Tests for Anti-Hallucination Plugin.

Validates the full lifecycle:
Pre-generation grounding -> Claim extraction -> Fact verification ->
Hallucination scoring -> Multi-sample consistency -> Citation tracking.
"""

import unittest
from src.core.claim_extractor import ClaimExtractor
from src.core.verifier import FactVerifier, VerificationStatus
from src.core.scorer import HallucinationScorer, RiskLevel
from src.core.consistency_checker import ConsistencyChecker
from src.core.citation_tracker import CitationTracker
from src.connectors.search_retriever import SearchRetriever, EvidencePassage
from src.guardrails.prompt_grounder import PromptGrounder, Strictness


class TestAntiHallucinationPipeline(unittest.TestCase):
    def setUp(self):
        # Setup mock retrieval corpus
        self.retriever = SearchRetriever.with_mock_corpus([
            "The Hubble Space Telescope was launched into low Earth orbit in 1990.",
            "Hubble was named after astronomer Edwin Hubble and remains in operation.",
            "Hubble's orbit is approximately 540 kilometers above Earth.",
        ])
        self.grounder = PromptGrounder(retriever=self.retriever, strictness=Strictness.STRICT)
        self.extractor = ClaimExtractor()
        self.verifier = FactVerifier()
        self.scorer = HallucinationScorer()
        self.checker = ConsistencyChecker()
        self.tracker = CitationTracker()

    def test_pre_generation_grounding(self):
        query = "When was Hubble launched and where is it located?"
        assessment = self.grounder.assess(query)
        self.assertFalse(assessment.needs_clarification)

        grounded = self.grounder.ground(query)
        self.assertIn("Hubble", grounded.user_prompt)
        self.assertGreaterEqual(len(grounded.evidence), 1)
        self.assertIn("[S1]", grounded.user_prompt)

    def test_end_to_end_verification_and_scoring(self):
        evidence_texts = self.retriever.retrieve_texts("Hubble Space Telescope launch", top_k=3)
        self.assertGreater(len(evidence_texts), 0)

        # Faithful response
        faithful_response = "The Hubble Space Telescope was launched in 1990. It is named after Edwin Hubble."
        claims = self.extractor.extract(faithful_response)
        self.assertGreaterEqual(len(claims), 2)

        verifications = self.verifier.verify_all(claims, evidence_texts)
        report = self.scorer.score(verifications)

        self.assertEqual(report.risk_level, RiskLevel.LOW)
        self.assertEqual(report.contradicted_claims, 0)
        self.assertLessEqual(report.hallucination_score, 0.2)

    def test_hallucination_detection_with_contradiction(self):
        evidence_texts = self.retriever.retrieve_texts("Hubble Space Telescope", top_k=3)

        # Hallucinated response contradicting the launch year and orbit
        hallucinated_response = "The Hubble Space Telescope was launched into low Earth orbit in 2018."
        claims = self.extractor.extract(hallucinated_response)
        verifications = self.verifier.verify_all(claims, evidence_texts)
        report = self.scorer.score(verifications)

        self.assertEqual(report.contradicted_claims, 1)
        self.assertIn(report.risk_level, [RiskLevel.HIGH, RiskLevel.CRITICAL])
        self.assertGreater(report.hallucination_score, 0.5)

    def test_self_consistency_and_citations(self):
        primary = "Hubble operates in low Earth orbit."
        samples = [
            "The Hubble telescope is located in low Earth orbit.",
            "Hubble orbits Earth in low orbit at around 540 km.",
            "Low Earth orbit is where Hubble operates."
        ]
        cons_report = self.checker.check_consistency(primary, samples)
        self.assertTrue(cons_report.stable_claims >= 1)

        sources = {
            "Doc1": "The Hubble Space Telescope was launched into low Earth orbit in 1990."
        }
        cit_report = self.tracker.attribute(primary, sources)
        self.assertEqual(cit_report.grounded_sentences, 1)
        self.assertIn("[Doc1]", cit_report.annotated_text)


if __name__ == "__main__":
    unittest.main()
