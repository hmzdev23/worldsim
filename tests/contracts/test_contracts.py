import copy
import json
import unittest
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
except ImportError:  # pragma: no cover
    Draft202012Validator = None

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def load(name):
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


@unittest.skipIf(Draft202012Validator is None, "pip install jsonschema to run contract checks")
class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        events = load("events.schema.json")
        stream = load("stream.schema.json")
        for schema in (events, stream):
            Draft202012Validator.check_schema(schema)
        registry = Registry().with_resources(
            (s["$id"], Resource.from_contents(s)) for s in (events, stream)
        )
        cls.events = Draft202012Validator(events, registry=registry)
        cls.stream = Draft202012Validator(stream, registry=registry)
        cls.fixture = load("fixtures/japan-earthquake.json")

    def errors(self, validator, doc):
        return [e.message for e in validator.iter_errors(doc)]

    def test_fixture_is_valid(self):
        self.assertEqual(self.errors(self.events, self.fixture), [])

    def test_fixture_events_are_in_canonical_order_with_unique_ids(self):
        events = self.fixture["events"]
        keys = [(e["sim_time_minutes"], e["sequence"]) for e in events]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len({e["id"] for e in events}), len(events))

    def test_earthquake_requires_magnitude(self):
        doc = copy.deepcopy(self.fixture)
        del doc["events"][0]["payload"]["magnitude"]
        self.assertTrue(self.errors(self.events, doc))

    def test_rejects_unknown_type_and_bad_coordinates(self):
        for path, value in ((("type",), "alien_invasion"), (("location", "lat"), 91)):
            doc = copy.deepcopy(self.fixture)
            target = doc["events"][0]
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.assertTrue(self.errors(self.events, doc), path)

    def event_of(self, type_, **payload):
        doc = copy.deepcopy(self.fixture)
        event = doc["events"][0]
        event["type"] = type_
        event["payload"] = payload
        return doc

    def test_extended_hazard_and_consequence_types(self):
        for type_, payload in (
            ("disease_outbreak", {"pathogen": "novel influenza", "radius_km": 300}),
            ("nuclear_detonation", {"yield_kt": 15, "origin": "unknown"}),
            ("cyber_attack", {"target": "power grid"}),
            ("meteor_impact", {"diameter_m": 120}),
            ("volcanic_eruption", {"vei": 6}),
            ("alien_contact", {"description": "Unidentified craft hover over the bay."}),
            ("other_hazard", {"label": "solar superstorm"}),
            ("conflict_escalation", {}),
            ("recovery", {}),
        ):
            self.assertEqual(self.errors(self.events, self.event_of(type_, **payload)), [], type_)

    def test_other_hazard_requires_label(self):
        self.assertTrue(self.errors(self.events, self.event_of("other_hazard")))

    def test_known_payload_keys_are_type_checked(self):
        for payload in ({"vei": 9}, {"yield_kt": -1}, {"radius_km": "big"}, {"description": "x" * 281}):
            self.assertTrue(self.errors(self.events, self.event_of("volcanic_eruption", **payload)), payload)

    def header(self, minutes):
        return {"schema_version": "0.1", "simulation_id": "demo-japan-earthquake",
                "branch_id": "main", "sim_time_minutes": minutes}

    def test_stream_messages(self):
        event = self.fixture["events"][0]
        playback = {"state": "playing", "speed": 4}
        valid = [
            {**self.header(0), "kind": "snapshot", "playback": playback, "events": []},
            {**self.header(402), "kind": "event", "event": event},
            {**self.header(403), "kind": "clock", "playback": playback},
        ]
        for msg in valid:
            self.assertEqual(self.errors(self.stream, msg), [], msg["kind"])

    def test_stream_rejects_unapplied_events_and_extra_fields(self):
        proposed = {**self.fixture["events"][0], "status": "proposed"}
        self.assertTrue(self.errors(self.stream, {**self.header(402), "kind": "event", "event": proposed}))
        clock = {**self.header(1), "kind": "clock", "playback": {"state": "paused", "speed": 1}, "extra": 1}
        self.assertTrue(self.errors(self.stream, clock))


if __name__ == "__main__":
    unittest.main()
