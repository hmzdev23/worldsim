import os,json,time,urllib.request,urllib.error,concurrent.futures,pathlib
key=os.environ['ELEVENLABS_API_KEY']
out=pathlib.Path(__file__).parent/'audio';out.mkdir(exist_ok=True)
voice=os.environ.get('ELEVENLABS_VOICE_ID','7QN34D2r3hCNwbOYIeK0')
lines=[
 'At six forty-two, a magnitude seven point eight earthquake strikes off Miyagi.',
 'Minutes later, a tsunami warning reaches the coast.',
 'Residents of Ishinomaki head for safety.',
 'In Sendai, power fails, and trains stop.',
 'Floodwater spreads across the coastal plain.',
 'The next day, international rescue teams arrive.',
 'Another aftershock hits as repairs begin.',
 'By day four, some rail lines reopen, and families begin leaving shelters.'
]
sounds={
 'quake':('Close urban earthquake rumble with building creaks, loose windows rattling and a low powerful tremor. No voices, no music.',4.5),
 'siren':('Distant coastal outdoor warning siren oscillating, natural outdoor air, no voice or music.',3.5),
 'crowd':('A small crowd walking briskly on a city pavement, several overlapping footsteps and distant indistinct murmur, no intelligible speech, no music.',4.5),
 'power':('Electrical power switches off with a short relay clunk, transformer hum dropping into quiet, no music.',3.0),
 'water':('Floodwater surging and splashing through an urban street, rushing water, no voices or music.',4.5),
 'aid':('Airport apron ambience with distant aircraft engine rumble and supply crates handled, no speech or music.',4.5),
 'train':('Modern passenger train starts moving along tracks, soft motor whirr and rhythmic wheel sounds, no announcement, no music.',5.0),
 'music':('Instrumental cinematic underscore for a short event timeline, gentle low piano pulses, warm soft pads, restrained and reflective, no drums, no vocals, no speech, seamless loop.',20.0)
}
def send(url,payload):
 req=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'xi-api-key':key,'Content-Type':'application/json','Accept':'audio/mpeg'},method='POST')
 for attempt in range(3):
  try:
   with urllib.request.urlopen(req,timeout=100) as r:
    data=r.read();cost=r.headers.get('character-cost','unknown')
   if len(data)<1000:raise RuntimeError('audio response too small')
   return data,cost
  except urllib.error.HTTPError as e:
   if e.code==429 and attempt<2:time.sleep(3*(attempt+1));continue
   raise RuntimeError(f'ElevenLabs HTTP {e.code} for {url.split("/")[-1]}') from None
  except urllib.error.URLError as e:raise RuntimeError(f'Network error: {e.reason}') from None
 raise RuntimeError('rate limit persists')
def sfx(name):
 p=out/('sfx-'+name+'.mp3')
 if p.exists() and p.stat().st_size>1000: return name,'cached'
 text,duration=sounds[name]
 data,cost=send('https://api.elevenlabs.io/v1/sound-generation',{'text':text,'duration_seconds':duration,'prompt_influence':0.5,'model_id':'eleven_text_to_sound_v3','loop':name=='music'})
 p.write_bytes(data);return name,cost
def speech(i):
 p=out/f'voice-{i+1:02}.mp3'
 if p.exists() and p.stat().st_size>1000:return f'voice-{i+1:02}','cached'
 data,cost=send(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128',{'text':lines[i],'model_id':'eleven_multilingual_v2','voice_settings':{'stability':0.55,'similarity_boost':0.75}})
 p.write_bytes(data);return f'voice-{i+1:02}',cost
# Test access to sound effects first; never silently substitute a different source.
try:
 name,cost=sfx('quake');print(name,'ready; cost',cost,flush=True)
except Exception as e:
 print('SOUND_EFFECTS_FAILED:',str(e),flush=True);raise SystemExit(1)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
 jobs=[ex.submit(speech,i) for i in range(len(lines))]+[ex.submit(sfx,n) for n in sounds if n!='quake']
 for job in concurrent.futures.as_completed(jobs):
  try:name,cost=job.result();print(name,'ready; cost',cost,flush=True)
  except Exception as e:print('AUDIO_FAILED:',str(e),flush=True);raise SystemExit(1)
(out/'narration-lines.json').write_text(json.dumps(lines,indent=2)+'\n')
