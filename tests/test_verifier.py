"""Unit tests for Anti-Hallucination Core Engine and MCP Tools."""

import unittest
from src.core.claim_extractor import ClaimExtractor, ClaimType
from src.core.verifier import FactVerifier, VerificationStatus
from src.core.scorer import HallucinationScorer, RiskLevel
from src.mcp.server import AntiHallucinationMCPServer


class TestClaimExtractor(unittest.TestCase):
    def setUp(self):
        self.extractor = ClaimExtractor()

    def test_numeric_and_temporal_extraction(self):
        text = "The Apollo 11 mission landed on the Moon in 1969, and three astronauts were on board."
        claims = self.extractor.extract(text)
        self.assertGreaterEqual(len(claims), 2)
        has_temporal = any(c.claim_type == ClaimType.TEMPORAL for c in claims)
        has_numeric = any(c.claim_type == ClaimType.NUMERIC for c in claims)
        self.assertTrue(has_temporal or has_numeric)

    def test_entity_extraction(self):
        text = "Albert Einstein developed the theory of relativity in Switzerland."
        claims = self.extractor.extract(text)
        entities = [e for c in claims for e in c.entities]
        self.assertTrue(any("Einstein" in e for e in entities))


class TestFactVerifier(unittest.TestCase):
    def setUp(self):
        self.extractor = ClaimExtractor()
        self.verifier = FactVerifier()

    def test_supported_claim(self):
        evidence = ["Water boils at 100 degrees Celsius under standard atmospheric pressure."]
        claims = self.extractor.extract("Water boils at 100 degrees Celsius.")
        results = self.verifier.verify_all(claims, evidence)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].status, VerificationStatus.SUPPORTED)
        self.assertGreater(results[0].confidence, 0.5)

    def test_contradicted_claim(self):
        evidence = ["The drug was approved by the FDA in 2021."]
        claims = self.extractor.extract("The drug was not approved by the FDA in 2021.")
        results = self.verifier.verify_all(claims, evidence)
        self.assertEqual(results[0].status, VerificationStatus.CONTRADICTED)

    def test_unsupported_claim(self):
        evidence = ["Python is a popular interpreted programming language."]
        claims = self.extractor.extract("The Eiffel Tower is 330 meters tall.")
        results = self.verifier.verify_all(claims, evidence)
        self.assertEqual(results[0].status, VerificationStatus.UNSUPPORTED)


class TestHallucinationScorer(unittest.TestCase):
    def setUp(self):
        self.extractor = ClaimExtractor()
        self.verifier = FactVerifier()
        self.scorer = HallucinationScorer()

    def test_low_risk_grounded_text(self):
        evidence = ["Paris is the capital of France. The river Seine flows through it."]
        generated = "Paris is the capital of France."
        claims = self.extractor.extract(generated)
        results = self.verifier.verify_all(claims, evidence)
        report = self.scorer.score(results)
        self.assertEqual(report.risk_level, RiskLevel.LOW)
        self.assertEqual(report.hallucination_score, 0.0)

    def test_high_risk_hallucinated_text(self):
        evidence = ["Mars is the fourth planet from the Sun."]
        generated = "Mars is covered in vast liquid oceans, and humans established cities there in 1950."
        claims = self.extractor.extract(generated)
        results = self.verifier.verify_all(claims, evidence)
        report = self.scorer.score(results)
        self.assertIn(report.risk_level, [RiskLevel.HIGH, RiskLevel.CRITICAL, RiskLevel.MEDIUM])
        self.assertGreater(report.hallucination_score, 0.0)


class TestMCPServer(unittest.TestCase):
    def setUp(self):
        self.server = AntiHallucinationMCPServer()

    def test_tool_definitions(self):
        tools = self.server.get_tool_definitions()
        tool_names = [t["name"] for t in tools]
        self.assertIn("extract_claims", tool_names)
        self.assertIn("verify_claims", tool_names)
        self.assertIn("check_hallucination", tool_names)
        self.assertIn("get_anti_hallucination_system_prompt", tool_names)

    def test_check_hallucination_tool(self):
        res = self.server.handle_tool_call("check_hallucination", {
            "generated_text": "Photosynthesis is the process by which green plants make food.",
            "evidence_passages": ["Green plants use photosynthesis to produce food and energy from sunlight."]
        })
        self.assertIn("hallucination_score", res)
        self.assertIn("risk_level", res)
        self.assertEqual(res["risk_level"], "LOW")

class TestConsistencyChecker(unittest.TestCase):
    def setUp(self):
        from src.core.consistency_checker import ConsistencyChecker
        self.checker = ConsistencyChecker()

    def test_consistent_samples(self):
        primary = "The capital of Japan is Tokyo."
        samples = [
            "Tokyo is the official capital city of Japan.",
            "Japan's capital is Tokyo, known for its dense population.",
            "The capital city of Japan is Tokyo."
        ]
        report = self.checker.check_consistency(primary, samples)
        self.assertEqual(report.stable_claims, 1)
        self.assertEqual(report.unstable_claims, 0)
        self.assertGreaterEqual(report.overall_consistency_score, 0.6)

    def test_inconsistent_samples(self):
        primary = "The discovery occurred in 1999."
        samples = [
            "The discovery occurred in 1845.",
            "It was discovered back in 1720.",
            "Scientists made the discovery in 2015."
        ]
        report = self.checker.check_consistency(primary, samples)
        self.assertEqual(report.stable_claims, 0)
        self.assertEqual(report.unstable_claims, 1)


class TestCitationTracker(unittest.TestCase):
    def setUp(self):
        from src.core.citation_tracker import CitationTracker
        self.tracker = CitationTracker()

    def test_citation_attribution(self):
        sources = {
            "doc1": "Penicillin was discovered by Alexander Fleming in 1928 at St Mary's Hospital.",
            "doc2": "Aspirin is used to reduce pain, fever, or inflammation."
        }
        text = "Penicillin was discovered by Alexander Fleming. The moon is made of green cheese."
        report = self.tracker.attribute(text, sources)
        self.assertEqual(report.total_sentences, 2)
        self.assertEqual(report.grounded_sentences, 1)
        self.assertEqual(report.ungrounded_sentences, 1)
        self.assertIn("[doc1]", report.annotated_text)
        self.assertIn("[UNVERIFIED]", report.annotated_text)


if __name__ == "__main__":
    unittest.main()
