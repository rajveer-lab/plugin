"""Atomic Claim Extractor Module.

Decomposes unstructured LLM responses into granular, verifiable atomic propositions
to facilitate precision fact-checking and hallucination detection.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ClaimType(str, Enum):
    NUMERIC = "numeric"
    FACTUAL = "factual"
    TEMPORAL = "temporal"
    RELATIONAL = "relational"
    GENERAL = "general"


@dataclass
class AtomicClaim:
    """Represents an isolated, verifiable claim extracted from text."""
    id: str
    text: str
    claim_type: ClaimType
    source_sentence: str
    sentence_idx: int
    entities: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class ClaimExtractor:
    """Extracts atomic factual claims from raw model generated responses."""

    def __init__(self, min_length: int = 5):
        self.min_length = min_length
        # Regex patterns for identifying specific claim archetypes
        self.numeric_pattern = re.compile(r"\b\d+(?:[\.,]\d+)?%?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\b", re.IGNORECASE)
        self.year_pattern = re.compile(r"\b(?:18|19|20)\d{2}\b")
        self.entity_pattern = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b")

    def split_into_sentences(self, text: str) -> List[str]:
        """Splits narrative into discrete sentences, respecting abbreviations."""
        raw_sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", text.strip())
        cleaned = []
        for s in raw_sentences:
            s_str = s.strip()
            if s_str and len(s_str) >= self.min_length:
                cleaned.append(s_str)
        return cleaned

    def extract_atomic_propositions(self, sentence: str) -> List[str]:
        """Decomposes compound sentences (clauses joined by conjunctions/semicolons) into atomic propositions."""
        # Split on semicolons or distinct coordinating conjunctions if independent
        sub_clauses = re.split(r";\s*|\s+(?:furthermore|additionally|moreover),\s*", sentence, flags=re.IGNORECASE)
        propositions = []
        for clause in sub_clauses:
            clause = clause.strip()
            # If compound with 'and' / 'while' / 'but' with substantial length, split carefully
            parts = re.split(r",\s+(?:and|but|while|whereas|however)\s+", clause, flags=re.IGNORECASE)
            for part in parts:
                p = part.strip()
                if len(p) >= self.min_length:
                    # Clean trailing punctuation
                    p_clean = p.rstrip(".,; ")
                    if p_clean:
                        propositions.append(p_clean)
        return propositions if propositions else [sentence]

    def classify_claim_type(self, claim_text: str) -> ClaimType:
        """Determines the primary category of the claim for targeted verification."""
        if self.year_pattern.search(claim_text):
            return ClaimType.TEMPORAL
        if self.numeric_pattern.search(claim_text):
            return ClaimType.NUMERIC
        if any(keyword in claim_text.lower() for keyword in ["is", "was", "are", "were", "located", "founded", "created"]):
            return ClaimType.RELATIONAL
        return ClaimType.FACTUAL

    def extract_entities(self, text: str) -> List[str]:
        """Extracts candidate named entities (capitalized phrases/proper nouns)."""
        matches = self.entity_pattern.findall(text)
        # Filter out common sentence starters
        stopwords = {"The", "This", "That", "These", "Those", "It", "They", "We", "In", "On", "At", "However", "Furthermore", "Additionally"}
        return [m for m in set(matches) if m not in stopwords]

    def extract(self, text: str) -> List[AtomicClaim]:
        """Main entry point: Extracts all atomic claims from the text."""
        sentences = self.split_into_sentences(text)
        extracted_claims: List[AtomicClaim] = []
        claim_counter = 1

        for s_idx, sentence in enumerate(sentences):
            propositions = self.extract_atomic_propositions(sentence)
            for prop in propositions:
                c_type = self.classify_claim_type(prop)
                entities = self.extract_entities(prop)
                claim = AtomicClaim(
                    id=f"claim_{claim_counter:03d}",
                    text=prop,
                    claim_type=c_type,
                    source_sentence=sentence,
                    sentence_idx=s_idx,
                    entities=entities,
                    metadata={
                        "has_numbers": bool(self.numeric_pattern.search(prop)),
                        "has_temporal": bool(self.year_pattern.search(prop)),
                    },
                )
                extracted_claims.append(claim)
                claim_counter += 1

        return extracted_claims
