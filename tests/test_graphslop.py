import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "graphslop" / "scripts" / "graphslop.py"


def run(*args: str, expect: int = 0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        check=False,
        text=True,
    )
    if result.returncode != expect:
        raise AssertionError(
            f"expected {expect}, got {result.returncode}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def node(node_id: str, node_type: str, status: str = "confirmed", **extra: object) -> dict:
    return {"id": node_id, "type": node_type, "status": status, **extra}


class GraphslopTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        run("init", "--root", str(self.root), "--name", "Tiny Tool")
        self.factory = self.root / ".factory"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def make_intent(self) -> None:
        graph = json.loads((self.factory / "intent/graph.json").read_text())
        graph["version"] = 1
        graph["nodes"] = [
            node("goal", "Goal"),
            node("user", "UserType"),
            node("behavior", "Behavior"),
            node("input", "Input"),
            node("output", "Output"),
            node("success", "SuccessCriterion"),
        ]
        write(self.factory / "intent/graph.json", graph)

    def freeze_intent(self) -> None:
        self.make_intent()
        run(
            "freeze", "--root", str(self.root), "--graph", "intent",
            "--message-id", "msg-approve-intent",
        )

    def freeze_solution(self) -> None:
        self.freeze_intent()
        graph = json.loads((self.factory / "solution/graph.json").read_text())
        graph["version"] = 1
        graph["nodes"] = [
            node("feature", "Feature", satisfies_intent=["behavior", "output"])
        ]
        write(self.factory / "solution/graph.json", graph)
        run("freeze", "--root", str(self.root), "--graph", "solution")

    def test_init_creates_a_valid_empty_pack(self) -> None:
        output = run("validate", "--root", str(self.root))
        self.assertEqual(json.loads(output.stdout)["nodes"]["intent"], 0)
        self.assertTrue((self.factory / "messages.jsonl").exists())

    def test_intent_freeze_is_versioned_and_hashed(self) -> None:
        self.freeze_intent()
        baseline = json.loads(
            (self.factory / "intent/baselines/intent-v1.json").read_text()
        )
        self.assertEqual(baseline["baseline_id"], "intent-v1")
        self.assertEqual(len(baseline["sha256"]), 64)

        run("freeze", "--root", str(self.root), "--graph", "intent")
        self.assertTrue((self.factory / "intent/baselines/intent-v2.json").exists())

    def test_solution_must_trace_to_intent(self) -> None:
        self.freeze_intent()
        graph = json.loads((self.factory / "solution/graph.json").read_text())
        graph["nodes"] = [node("orphan", "Feature", status="proposed")]
        write(self.factory / "solution/graph.json", graph)
        result = run("validate", "--root", str(self.root), expect=1)
        self.assertIn("does not trace to intent", result.stderr)

    def test_solution_cannot_trace_to_unapproved_intent(self) -> None:
        self.make_intent()
        graph = json.loads((self.factory / "intent/graph.json").read_text())
        graph["nodes"].append(node("maybe", "Preference", status="proposed"))
        write(self.factory / "intent/graph.json", graph)
        run("freeze", "--root", str(self.root), "--graph", "intent")
        solution = json.loads((self.factory / "solution/graph.json").read_text())
        solution["nodes"] = [
            node("feature", "Feature", status="proposed", satisfies_intent=["maybe"])
        ]
        write(self.factory / "solution/graph.json", solution)
        result = run("validate", "--root", str(self.root), expect=1)
        self.assertIn("missing baseline intent", result.stderr)

    def test_validate_detects_baseline_tampering(self) -> None:
        self.freeze_intent()
        path = self.factory / "intent/baselines/intent-v1.json"
        baseline = json.loads(path.read_text())
        baseline["graph"]["nodes"][0]["statement"] = "changed after approval"
        write(path, baseline)
        result = run("validate", "--root", str(self.root), expect=1)
        self.assertIn("hash does not match", result.stderr)

    def test_new_intent_baseline_invalidates_solution_authority(self) -> None:
        self.freeze_solution()
        run("freeze", "--root", str(self.root), "--graph", "intent")
        status = json.loads((self.factory / "status.json").read_text())
        self.assertIsNone(status["active_solution_baseline"])

    def test_execution_cycle_is_rejected(self) -> None:
        self.freeze_solution()
        common = {
            "status": "pending",
            "satisfies_solution": ["feature"],
            "allowed_paths": ["src/**"],
            "forbidden_changes": [],
            "acceptance_checks": ["works"],
            "protected_intent_baseline": "intent-v1",
            "protected_solution_baseline": "solution-v1",
        }
        graph = json.loads((self.factory / "execution/graph.json").read_text())
        graph["nodes"] = [
            node("a", "Implement", objective="Do A", dependencies=["b"], **common),
            node("b", "Test", objective="Do B", dependencies=["a"], **common),
        ]
        write(self.factory / "execution/graph.json", graph)
        result = run("validate", "--root", str(self.root), expect=1)
        self.assertIn("dependency cycle", result.stderr)

    def test_next_returns_only_dependency_ready_jobs(self) -> None:
        self.freeze_solution()
        common = {
            "satisfies_solution": ["feature"],
            "allowed_paths": ["src/**"],
            "forbidden_changes": [],
            "acceptance_checks": ["works"],
            "protected_intent_baseline": "intent-v1",
            "protected_solution_baseline": "solution-v1",
        }
        graph = json.loads((self.factory / "execution/graph.json").read_text())
        graph["nodes"] = [
            node(
                "inspect", "Inspect", status="accepted", objective="Read repo",
                dependencies=[], **common,
            ),
            node(
                "build", "Implement", status="pending", objective="Build it",
                dependencies=["inspect"], **common,
            ),
            node(
                "test", "Test", status="pending", objective="Test it",
                dependencies=["build"], **common,
            ),
        ]
        write(self.factory / "execution/graph.json", graph)
        output = json.loads(run("next", "--root", str(self.root)).stdout)
        self.assertEqual([item["id"] for item in output["ready"]], ["build"])


if __name__ == "__main__":
    unittest.main()
