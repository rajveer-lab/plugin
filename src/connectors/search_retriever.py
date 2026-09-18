"""Search Retriever Connector.

Pluggable retrieval layer that supplies reference evidence for grounding prompts
and verifying claims. Ships with three backends:

- InMemoryBackend: BM25 keyword search over passages held in memory (offline, for tests).
- LocalDocumentBackend: the same search over .txt/.md files loaded from disk.
- BraveSearchBackend: live web search through the Brave Search API.

Run standalone (offline demo):
    python -m src.connectors.search_retriever "your query"
"""

from __future__ import annotations

import html
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union

_TOKEN_PATTERN = re.compile(r"\b\w+\b")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_STOPWORDS = {
    "a", "an", "the", "in", "on", "at", "to", "for", "with", "by", "from", "of", "and", "or",
    "is", "was", "are", "were", "been", "be", "it", "this", "that", "what", "which", "who",
    "when", "where", "how", "why", "do", "does", "did",
}


@dataclass
class EvidencePassage:
    """A single retrieved passage that can be cited as reference evidence."""
    id: str
    text: str
    source: str
    url: Optional[str] = None
    score: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


def _tokenize(text: str) -> List[str]:
    return [t for t in _TOKEN_PATTERN.findall(text.lower()) if t not in _STOPWORDS]


def chunk_text(text: str, chunk_size: int = 600) -> List[str]:
    """Splits text into passages of roughly chunk_size characters on paragraph/sentence boundaries."""
    pieces: List[str] = []
    for paragraph in re.split(r"\n\s*\n", text):
        paragraph = " ".join(paragraph.split())
        if not paragraph:
            continue
        if len(paragraph) <= chunk_size:
            pieces.append(paragraph)
            continue
        for sentence in _SENTENCE_SPLIT.split(paragraph):
            # Hard-split sentences that are longer than a whole chunk
            pieces.extend(sentence[i:i + chunk_size] for i in range(0, len(sentence), chunk_size))

    chunks: List[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + 1 + len(piece) > chunk_size:
            chunks.append(current)
            current = piece
        else:
            current = f"{current} {piece}".strip()
    if current:
        chunks.append(current)
    return chunks


class RetrievalBackend(ABC):
    """Interface every retrieval source implements."""

    name: str = "base"

    @abstractmethod
    def search(self, query: str, top_k: int) -> List[EvidencePassage]:
        """Returns up to top_k passages, best match first."""


class InMemoryBackend(RetrievalBackend):
    """BM25 keyword search over passages held in memory. No network access."""

    name = "memory"

    def __init__(self, chunk_size: int = 600, k1: float = 1.5, b: float = 0.75):
        self.chunk_size = chunk_size
        self.k1 = k1
        self.b = b
        self._passages: List[EvidencePassage] = []
        self._term_freqs: List[Counter] = []
        self._doc_freq: Counter = Counter()
        self._total_length = 0

    def __len__(self) -> int:
        return len(self._passages)

    def add_text(
        self,
        text: str,
        source: str = "inline",
        url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        """Chunks and indexes a text. Returns the ids of the new passages."""
        ids = []
        for chunk in chunk_text(text, self.chunk_size):
            passage = EvidencePassage(
                id=f"{self.name}:{len(self._passages) + 1}",
                text=chunk,
                source=source,
                url=url,
                metadata=dict(metadata or {}),
            )
            term_freq = Counter(_tokenize(chunk))
            self._passages.append(passage)
            self._term_freqs.append(term_freq)
            self._doc_freq.update(term_freq.keys())
            self._total_length += sum(term_freq.values())
            ids.append(passage.id)
        return ids

    def search(self, query: str, top_k: int) -> List[EvidencePassage]:
        query_terms = set(_tokenize(query))
        if not query_terms or not self._passages:
            return []

        n_docs = len(self._passages)
        avg_length = self._total_length / n_docs or 1.0
        scored = []
        for passage, term_freq in zip(self._passages, self._term_freqs):
            length = sum(term_freq.values())
            score = 0.0
            for term in query_terms:
                tf = term_freq.get(term, 0)
                if not tf:
                    continue
                df = self._doc_freq[term]
                idf = math.log((n_docs - df + 0.5) / (df + 0.5) + 1.0)
                score += idf * tf * (self.k1 + 1) / (tf + self.k1 * (1 - self.b + self.b * length / avg_length))
            if score > 0:
                scored.append((score, passage))

        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            EvidencePassage(p.id, p.text, p.source, p.url, round(score, 4), dict(p.metadata))
            for score, p in scored[:top_k]
        ]


class LocalDocumentBackend(InMemoryBackend):
    """BM25 search over text files loaded from local files or folders."""

    name = "documents"

    def __init__(
        self,
        paths: Sequence[Union[str, Path]],
        extensions: Sequence[str] = (".txt", ".md"),
        chunk_size: int = 600,
    ):
        super().__init__(chunk_size=chunk_size)
        self.extensions = {e.lower() for e in extensions}
        for path in paths:
            self.add_path(path)

    def add_path(self, path: Union[str, Path]) -> int:
        """Indexes a file, or every matching file under a folder. Returns the number of files read."""
        path = Path(path)
        files = [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
        count = 0
        for file in files:
            if file.suffix.lower() not in self.extensions:
                continue
            text = file.read_text(encoding="utf-8", errors="replace")
            self.add_text(text, source=file.name, metadata={"path": str(file)})
            count += 1
        return count


class BraveSearchBackend(RetrievalBackend):
    """Live web search via the Brave Search API. Needs an API key in the environment."""

    name = "web"
    ENDPOINT = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: Optional[str] = None, api_key_env: str = "BRAVE_SEARCH_API_KEY", timeout: float = 10.0):
        self.api_key = api_key or os.environ.get(api_key_env)
        self.api_key_env = api_key_env
        self.timeout = timeout

    def search(self, query: str, top_k: int) -> List[EvidencePassage]:
        if not self.api_key:
            raise RuntimeError(f"Brave Search API key not set (expected environment variable {self.api_key_env}).")

        params = urllib.parse.urlencode({"q": query, "count": max(1, min(top_k, 20))})
        request = urllib.request.Request(
            f"{self.ENDPOINT}?{params}",
            headers={"Accept": "application/json", "X-Subscription-Token": self.api_key},
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            data = json.loads(response.read().decode("utf-8"))

        passages = []
        for rank, item in enumerate(data.get("web", {}).get("results", [])[:top_k]):
            snippet = html.unescape(re.sub(r"<[^>]+>", "", item.get("description", ""))).strip()
            if not snippet:
                continue
            passages.append(EvidencePassage(
                id=f"{self.name}:{rank + 1}",
                text=snippet,
                source=item.get("title") or item.get("url", "web"),
                url=item.get("url"),
                score=round(1.0 / (rank + 1), 4),
            ))
        return passages


class SearchRetriever:
    """Queries one or more backends and merges their results into a single evidence list."""

    def __init__(self, backends: Optional[Sequence[RetrievalBackend]] = None, top_k: int = 5):
        self.backends: List[RetrievalBackend] = list(backends or [])
        self.top_k = top_k
        self.last_errors: Dict[str, str] = {}

    def add_backend(self, backend: RetrievalBackend) -> None:
        self.backends.append(backend)

    def retrieve(self, query: str, top_k: Optional[int] = None) -> List[EvidencePassage]:
        """Returns up to top_k unique passages across all backends.

        Scores from different backends aren't comparable, so results are interleaved by rank.
        A failing backend is skipped and its error recorded in last_errors.
        """
        top_k = top_k or self.top_k
        self.last_errors = {}
        ranked_lists = []
        for backend in self.backends:
            try:
                ranked_lists.append(backend.search(query, top_k))
            except Exception as exc:  # one broken source shouldn't block the others
                self.last_errors[backend.name] = str(exc)

        merged: List[EvidencePassage] = []
        seen = set()
        for rank in range(top_k):
            for results in ranked_lists:
                if rank >= len(results):
                    continue
                key = " ".join(results[rank].text.lower().split())[:200]
                if key in seen:
                    continue
                seen.add(key)
                merged.append(results[rank])
        return merged[:top_k]

    def retrieve_texts(self, query: str, top_k: Optional[int] = None) -> List[str]:
        """Plain passage strings, in the shape FactVerifier.verify_all expects."""
        return [p.text for p in self.retrieve(query, top_k)]

    @classmethod
    def with_mock_corpus(cls, passages: Iterable[Union[str, Dict[str, Any]]], top_k: int = 5) -> "SearchRetriever":
        """Builds an offline retriever from strings or {"text", "source", "url"} dicts."""
        backend = InMemoryBackend()
        for item in passages:
            if isinstance(item, str):
                backend.add_text(item)
            else:
                backend.add_text(item["text"], source=item.get("source", "inline"), url=item.get("url"))
        return cls([backend], top_k=top_k)

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "SearchRetriever":
        """Builds a retriever from the `retrieval` section of config.yaml."""
        retriever = cls(top_k=int(config.get("top_k", 5)))
        for spec in config.get("backends", []):
            kind = spec.get("type")
            if kind == "memory":
                retriever.add_backend(cls.with_mock_corpus(spec.get("passages", [])).backends[0])
            elif kind == "documents":
                retriever.add_backend(LocalDocumentBackend(
                    spec.get("paths", []),
                    extensions=spec.get("extensions", (".txt", ".md")),
                    chunk_size=int(spec.get("chunk_size", 600)),
                ))
            elif kind == "web":
                provider = spec.get("provider", "brave")
                if provider != "brave":
                    raise ValueError(f"Unsupported web search provider: {provider}")
                retriever.add_backend(BraveSearchBackend(
                    api_key_env=spec.get("api_key_env", "BRAVE_SEARCH_API_KEY"),
                    timeout=float(spec.get("timeout", 10.0)),
                ))
            else:
                raise ValueError(f"Unknown retrieval backend type: {kind}")
        return retriever


if __name__ == "__main__":
    demo = SearchRetriever.with_mock_corpus([
        {"text": "The Eiffel Tower was completed in 1889 for the Exposition Universelle in Paris.", "source": "eiffel.md"},
        {"text": "The Statue of Liberty was dedicated in 1886 and stands on Liberty Island in New York Harbor.", "source": "liberty.md"},
        {"text": "Mount Everest is 8,849 metres tall, according to the 2020 China-Nepal survey.", "source": "everest.md"},
    ])
    query = " ".join(sys.argv[1:]) or "When was the Eiffel Tower completed?"
    print(f"Query: {query}")
    for passage in demo.retrieve(query, top_k=3):
        print(f"  [{passage.score:.3f}] {passage.source}: {passage.text}")
