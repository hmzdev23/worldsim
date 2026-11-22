import json,os,urllib.request
req=urllib.request.Request('https://api.elevenlabs.io/v1/sound-generation',data=json.dumps({'text':'Instrumental cinematic news timeline underscore: an urgent but restrained rhythmic pulse, warm low piano and subtle percussion, gradually building momentum, no voice, no speech, no loud impacts, seamless loop.','duration_seconds':20,'prompt_influence':0.5,'model_id':'eleven_text_to_sound_v3','loop':True}).encode(),headers={'xi-api-key':os.environ['ELEVENLABS_API_KEY'],'Content-Type':'application/json','Accept':'audio/mpeg'},method='POST')
with urllib.request.urlopen(req,timeout=100) as r: data=r.read()
if len(data)<1000: raise RuntimeError('Audio response is too short')
open('audio/sfx-music.mp3','wb').write(data)
print('Music ready')
