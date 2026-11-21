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

    def test_fixture_is_a_multi_day_chain_with_resolving_parents(self):
        events = self.fixture["events"]
        self.assertGreater(events[-1]["sim_time_minutes"] - events[0]["sim_time_minutes"], 24 * 60)
        seen = set()
        for event in events:
            for parent in event["parent_ids"]:
                self.assertIn(parent, seen, f"{event['id']} names {parent} before it happens")
            seen.add(event["id"])
        aid = {e["payload"]["origin"] for e in events if e["type"] == "international_aid"}
        self.assertGreaterEqual(len(aid), 2)

    def test_fixture_impacts_are_labeled_running_totals(self):
        snaps = [e["payload"]["impacts"] for e in self.fixture["events"]]
        self.assertTrue(all(s["basis"] == "fictional_estimate" for s in snaps))
        for key in ("deaths", "injuries", "economic_loss_usd", "debris_tonnes"):
            values = [s.get(key, 0) for s in snaps]
            self.assertEqual(values, sorted(values), f"{key} is cumulative and must never fall")
        for earlier, later in zip(snaps, snaps[1:]):
            before = {c["country"]: c for c in earlier.get("aid_contributors", [])}
            after = {c["country"]: c for c in later.get("aid_contributors", [])}
            self.assertLessEqual(set(before), set(after), "aid contributors never disappear")
            for country, entry in before.items():
                self.assertLessEqual(entry.get("personnel", 0), after[country].get("personnel", 0))
            self.assertTrue(later.get("sheltered", 0) <= later.get("displaced", 0))

    def test_impacts_shape_is_enforced(self):
        def with_impacts(impacts):
            doc = copy.deepcopy(self.fixture)
            doc["events"][0]["payload"]["impacts"] = impacts
            return doc

        self.assertEqual(self.errors(self.events, with_impacts({"basis": "fictional_estimate"})), [])
        for bad in (
            {"deaths": 3},                                           # missing the fictional marker
            {"basis": "official", "deaths": 3},                      # wrong marker
            {"basis": "fictional_estimate", "deaths": -1},
            {"basis": "fictional_estimate", "deaths": 1.5},
            {"basis": "fictional_estimate", "casualties": 3},        # unknown key
            {"basis": "fictional_estimate", "aid_contributors": [{"personnel": 5}]},  # no country
            {"basis": "fictional_estimate", "aid_contributors": [{"country": "Chile", "ships": 2}]},
            {"basis": "fictional_estimate", "injured": 3},           # old name
        ):
            self.assertTrue(self.errors(self.events, with_impacts(bad)), bad)

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
