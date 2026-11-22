"""All catalogue roles must launch, decide and finish through the real engine."""
import copy
import json
import unittest
from test_player import CATALOGUE, session, play_until_card, TestClient, ScenarioRegistry, Simulation, create_app
from worlddirector import prepare_scenario
from worlddirector.runner import PLAYABLE_FIXTURES


class GameplayExpansionTests(unittest.TestCase):
    def test_exactly_ten_catalogue_scenarios_and_fifty_roles(self):
        specs = CATALOGUE.list()
        self.assertEqual(len(specs), 10)
        self.assertEqual(sum(len(s['roles']) for s in specs), 50)
        self.assertEqual({s['fixture'] for s in specs}, set(PLAYABLE_FIXTURES))

    def test_every_role_completes_baseline_and_action_run_deterministically(self):
        for item in CATALOGUE.list():
            fixture = item['fixture']
            batch = prepare_scenario('Fictional gameplay', simulation_id='run-check', fixture=fixture)
            seen = set()
            for event in batch['events']:
                self.assertTrue(set(event['parent_ids']) <= seen)
                seen.add(event['id'])
                self.assertTrue(-90 <= event['location']['lat'] <= 90)
                self.assertTrue(-180 <= event['location']['lon'] <= 180)
            for role in item['roles']:
                with self.subTest(scenario=fixture, role=role['id']):
                    outcomes = []
                    for policy in ['do_nothing', 'action', 'action']:
                        player = session(fixture, role['id'])
                        original = copy.deepcopy(player.sim.timeline)
                        baseline = copy.deepcopy(player.baseline)
                        count = 0
                        while (point := play_until_card(player)) is not None:
                            count += 1
                            self.assertLess(count, 30)
                            self.assertEqual(len(point.options), 3)
                            self.assertEqual(len({o['id'] for o in point.options}), 3)
                            self.assertIn(role['responsibilities'], point.situation)
                            action = 'do_nothing' if policy == 'do_nothing' else point.options[(count-1)%3]['id']
                            player.decide(point.id, option_id=action, at_minutes=player.sim.now)
                            self.assertEqual(player.segments[0].sim.timeline, original)
                            self.assertEqual(player.baseline, baseline)
                        self.assertGreaterEqual(count, 3)
                        summary = player.summary()
                        self.assertTrue(summary['finished'])
                        self.assertTrue(0 <= summary['score']['total'] <= 100)
                        self.assertTrue(summary['comparison']['initial_conditions']['identical'])
                        self.assertTrue(summary['comparison']['metrics'])
                        self.assertTrue(all(m['final'] is not None for m in summary['comparison']['metrics']))
                        if policy == 'do_nothing':
                            self.assertEqual(summary['score']['total'], 70)
                        else:
                            outcomes.append((player.sim.timeline, summary['score']))
                    self.assertEqual(outcomes[0], outcomes[1])

    def test_every_action_validates_and_changes_a_future(self):
        for item in CATALOGUE.list():
            spec = CATALOGUE.spec(item['fixture'])
            for role in spec['roles']:
                player = session(item['fixture'], role['id'])
                point = play_until_card(player)
                for option in point.options:
                    with self.subTest(scenario=item['fixture'], role=role['id'], option=option['id']):
                        candidate = session(item['fixture'], role['id'])
                        point2 = play_until_card(candidate)
                        candidate.decide(point2.id, option_id=option['id'], at_minutes=candidate.sim.now)
                        self.assertNotEqual(candidate.active.branch_id, 'main')
                        self.assertNotEqual(candidate.sim.timeline, candidate.segments[0].sim.timeline)

    def test_http_launch_for_every_scenario_role_and_released_phases_only(self):
        registry = ScenarioRegistry()
        with TestClient(create_app(sim=Simulation(simulation_id="demo-test"), scenarios=registry, tick_seconds=3600)) as client:
            catalogue = client.get('/player/scenarios').json()['scenarios']
            for item in catalogue:
                for role in item['roles']:
                    with self.subTest(scenario=item['fixture'], role=role['id']):
                        response = client.post('/scenarios', json={'prompt':'Fictional mission','fixture':item['fixture'],'mode':'player','role':role['id']})
                        self.assertEqual(response.status_code,202)
                        run_id=response.json()['id']
                        import time
                        for _ in range(200):
                            ready=client.get(f'/scenarios/{run_id}').json()
                            if ready['status'] != 'generating': break
                            time.sleep(.005)
                        self.assertEqual(ready['status'],'ready')
                        state=client.get(f'/scenarios/{run_id}/player').json()
                        if state['phase'] is not None:
                            self.assertLessEqual(state['phase']['at_minutes'],state['sim_time_minutes'])
                        self.assertEqual(state['role']['responsibilities'],role['responsibilities'])
                        timeline=client.get(f'/scenarios/{run_id}/timeline').json()
                        self.assertGreaterEqual(len(timeline['events']),8)


    def test_new_city_reports_have_their_own_grounded_locations(self):
        expected = {'alien-invasion': ('Cairo', 'Rome'), 'ai-takeover': ('Tokyo', 'Taipei'),
                    'sun-disappearing': ('London', 'Singapore')}
        for fixture, names in expected.items():
            batch = prepare_scenario('Fictional scenario', simulation_id='run-places', fixture=fixture)
            self.assertEqual(tuple(batch['events'][i]['location']['name'] for i in (3,6)),names)
        batch = prepare_scenario('Fictional scenario', simulation_id='run-monitor', fixture='nuclear-war')
        self.assertEqual(batch['events'][3]['type'],'other_hazard')
        self.assertIn('reporting hub',batch['events'][3]['location']['name'])
