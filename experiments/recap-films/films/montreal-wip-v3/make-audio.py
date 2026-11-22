import os,json,time,urllib.request,urllib.error,concurrent.futures,pathlib
key=os.environ['ELEVENLABS_API_KEY']; out=pathlib.Path(__file__).parent/'audio';out.mkdir(exist_ok=True)
voice=os.environ.get('ELEVENLABS_VOICE_ID','XA3P1cj7XJexe6Zq0ATX')
lines=[
 'A deadly respiratory illness emerges in Montreal. It spreads when infected people cough.',
 'Within two days, clinics expand testing as respiratory cases climb.',
 'By day seven, local transmission reaches Toronto, triggering new precautions indoors.',
 'A week later, infections spread in New York, and hospitals prepare.',
 'Canada coordinates case reporting, recommends masks and ventilation, and supports hospitals.',
 'By day thirty, staff absences disrupt travel, hospitality, and city services.',
 'Two months in, cases linked to travel begin spreading locally in Paris.',
 'Six months later, infections decline in early affected areas, and hospitals regain capacity. Monitoring continues.'
]
sounds={
 'cough':('Several distant natural human coughs in an outdoor city setting, discreet, no speech, no music.',4.0),
 'clinic':('Quiet hospital room ambience, heart monitor beep, faint ventilation, no voices, no music.',4.0),
 'alert':('Subtle electronic alert tones and soft digital pulse, tense, no voice, no music.',4.0),
 'city':('Quiet empty city ambience, distant traffic and wind, no voice, no music.',4.0)
}
def send(url,payload):
 req=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'xi-api-key':key,'Content-Type':'application/json','Accept':'audio/mpeg'},method='POST')
 for attempt in range(3):
  try:
   with urllib.request.urlopen(req,timeout=100) as r:data=r.read()
   if len(data)<1000:raise RuntimeError('short audio response')
   return data
  except urllib.error.HTTPError as e:
   if e.code==429 and attempt<2:time.sleep(3*(attempt+1));continue
   raise RuntimeError('ElevenLabs HTTP '+str(e.code)) from None
  except urllib.error.URLError: raise RuntimeError('ElevenLabs connection error') from None
 raise RuntimeError('ElevenLabs rate limit')
def speech(i):
 p=out/f'voice-{i+1:02}.mp3'
 if not p.exists():p.write_bytes(send('https://api.elevenlabs.io/v1/text-to-speech/'+voice+'?output_format=mp3_44100_128',{'text':lines[i],'model_id':'eleven_multilingual_v2','voice_settings':{'stability':.55,'similarity_boost':.75,'speed':1.15}}))
 return p.name
def sound(name):
 p=out/f'sfx-{name}.mp3'; desc,duration=sounds[name]
 if not p.exists():p.write_bytes(send('https://api.elevenlabs.io/v1/sound-generation',{'text':desc,'duration_seconds':duration,'prompt_influence':.5,'model_id':'eleven_text_to_sound_v3'}))
 return p.name
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
 jobs=[ex.submit(speech,i) for i in range(8)]+[ex.submit(sound,n) for n in sounds]
 for job in concurrent.futures.as_completed(jobs): print(job.result(),'ready',flush=True)
(out/'narration-lines.json').write_text(json.dumps(lines,indent=2)+'\n')
