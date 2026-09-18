"""Model Context Protocol (MCP) Server for Anti-Hallucination Tools.

Exposes hallucination detection, atomic claim extraction, and fact-checking tools
to AI assistants (Claude, Antigravity, Cursor, etc.) via standard MCP stdio protocol.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List

from ..core.claim_extractor import ClaimExtractor
from ..core.scorer import HallucinationScorer
from ..core.verifier import FactVerifier


class AntiHallucinationMCPServer:
    """MCP standard server providing anti-hallucination inspection and validation tools."""

    def __init__(self):
        self.extractor = ClaimExtractor()
        self.verifier = FactVerifier()
        self.scorer = HallucinationScorer()

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """Returns MCP tool definitions."""
        return [
            {
                "name": "extract_claims",
                "description": "Decomposes text into verifiable atomic factual claims, tagged by category (numeric, temporal, factual, relational).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "The AI response or text to analyze."}
                    },
                    "required": ["text"],
                },
            },
            {
                "name": "verify_claims",
                "description": "Checks extracted claims against provided evidence passages to identify supported, contradicted, and ungrounded statements.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "claims": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of claim strings to verify."
                        },
                        "evidence": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Ground truth or reference document passages."
                        }
                    },
                    "required": ["claims", "evidence"],
                },
            },
            {
                "name": "check_hallucination",
                "description": "Full end-to-end pipeline: extracts claims from generated text, validates against evidence, scores hallucination risk, and outputs a diagnostic report.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "generated_text": {"type": "string", "description": "The LLM response to audit for hallucinations."},
                        "evidence_passages": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Trusted reference passages or retrieval context."
                        }
                    },
                    "required": ["generated_text", "evidence_passages"],
                },
            },
            {
                "name": "get_anti_hallucination_system_prompt",
                "description": "Provides specialized system prompts and constraint rules that drastically reduce model hallucination rates.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "strictness": {
                            "type": "string",
                            "enum": ["moderate", "strict", "zero_tolerance"],
                            "default": "strict",
                            "description": "Constraint level."
                        }
                    }
                },
            }
        ]

    def handle_tool_call(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatches tool execution to the appropriate core engine."""
        if name == "extract_claims":
            text = args.get("text", "")
            claims = self.extractor.extract(text)
            return {
                "total_claims": len(claims),
                "claims": [
                    {
                        "id": c.id,
                        "text": c.text,
                        "type": c.claim_type.value,
                        "entities": c.entities,
                        "source_sentence": c.source_sentence,
                    }
                    for c in claims
                ],
            }

        elif name == "verify_claims":
            raw_claims = args.get("claims", [])
            evidence = args.get("evidence", [])
            from ..core.claim_extractor import AtomicClaim, ClaimType
            atomic_claims = [
                AtomicClaim(id=f"c_{i+1}", text=c, claim_type=ClaimType.FACTUAL, source_sentence=c, sentence_idx=i)
                for i, c in enumerate(raw_claims)
            ]
            results = self.verifier.verify_all(atomic_claims, evidence)
            report = self.scorer.score(results)
            return {
                "hallucination_score": report.hallucination_score,
                "confidence_score": report.confidence_score,
                "risk_level": report.risk_level.value,
                "verdict": report.verdict,
                "results": [
                    {
                        "claim": r.claim_text,
                        "status": r.status.value,
                        "confidence": r.confidence,
                        "evidence": r.matched_evidence,
                        "reasoning": r.reasoning,
                    }
                    for r in results
                ],
            }

        elif name == "check_hallucination":
            generated = args.get("generated_text", "")
            evidence = args.get("evidence_passages", [])
            claims = self.extractor.extract(generated)
            results = self.verifier.verify_all(claims, evidence)
            report = self.scorer.score(results)
            return {
                "total_claims": report.total_claims,
                "supported_claims": report.supported_claims,
                "contradicted_claims": report.contradicted_claims,
                "unsupported_claims": report.unsupported_claims,
                "hallucination_score": report.hallucination_score,
                "confidence_score": report.confidence_score,
                "risk_level": report.risk_level.value,
                "verdict": report.verdict,
                "breakdown": report.breakdown,
                "claims_analysis": [
                    {
                        "id": r.claim_id,
                        "text": r.claim_text,
                        "status": r.status.value,
                        "confidence": r.confidence,
                        "matched_evidence": r.matched_evidence,
                        "reasoning": r.reasoning,
                    }
                    for r in results
                ],
            }

        elif name == "get_anti_hallucination_system_prompt":
            strictness = args.get("strictness", "strict")
            try:
                from ..guardrails.prompt_grounder import PromptGrounder
                sys_prompt = PromptGrounder().system_prompt(strictness=strictness, has_evidence=True)
                return {"system_prompt": sys_prompt}
            except Exception:
                prompts = {
                    "moderate": (
                        "Guardrail Directive: Base all answers directly on verified evidence. "
                        "If a factual detail is uncertain, qualify it explicitly."
                    ),
                    "strict": (
                        "Strict Anti-Hallucination Directive:\n"
                        "1. Rely strictly and solely on the provided context.\n"
                        "2. Do NOT extrapolate, speculate, or fabricate numbers, dates, citations, or entity names.\n"
                        "3. If information is missing from the reference context, explicitly state: 'The provided context does not specify this information.'\n"
                        "4. Every factual assertion must be traceable to a specific source passage."
                    ),
                    "zero_tolerance": (
                        "Zero-Tolerance Grounding Directive:\n"
                        "1. You are operating in strict closed-book verification mode.\n"
                        "2. Every single proposition in your output MUST be directly entailed by the reference evidence.\n"
                        "3. Any ungrounded assertion is an invalid response.\n"
                        "4. If no reference passage explicitly answers the question, answer ONLY: 'INSUFFICIENT CONTEXT'."
                    ),
                }
                return {"system_prompt": prompts.get(strictness, prompts["strict"])}

        raise ValueError(f"Unknown tool: {name}")

    def run_stdio(self):
        """Standard MCP JSON-RPC stdio message loop."""
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                msg = json.loads(line)
                method = msg.get("method")
                msg_id = msg.get("id")

                if method == "tools/list":
                    resp = {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": self.get_tool_definitions()}}
                elif method == "tools/call":
                    params = msg.get("params", {})
                    name = params.get("name")
                    args = params.get("arguments", {})
                    tool_result = self.handle_tool_call(name, args)
                    resp = {
                        "jsonrpc": "2.0",
                        "id": msg_id,
                        "result": {"content": [{"type": "text", "text": json.dumps(tool_result, indent=2)}]}
                    }
                elif method == "initialize":
                    resp = {
                        "jsonrpc": "2.0",
                        "id": msg_id,
                        "result": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {"tools": {}},
                            "serverInfo": {"name": "anti-hallucination-server", "version": "1.0.0"}
                        }
                    }
                else:
                    resp = {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": "Method not found"}}

                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()
            except Exception as e:
                err_resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32603, "message": str(e)}}
                sys.stdout.write(json.dumps(err_resp) + "\n")
                sys.stdout.flush()


if __name__ == "__main__":
    server = AntiHallucinationMCPServer()
    server.run_stdio()
