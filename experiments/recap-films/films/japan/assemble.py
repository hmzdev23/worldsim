import json,subprocess,pathlib
root=pathlib.Path(__file__).resolve();root=root.parent
shots=root/'shots';audio=root/'audio';out=root/'output';out.mkdir(exist_ok=True)
shotfiles=[shots/f'shot-{i:02}.mp4' for i in range(1,9)]
assert all(p.is_file() for p in shotfiles),'A rendered shot is missing'
playlist=shots/'concat.txt';playlist.write_text(''.join(f"file '{p.name}'\n" for p in shotfiles))
picture=root/'picture.mp4'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(playlist),'-c','copy',str(picture)],check=True)
starts=[0,5,9,14,18,23,28,33]; ends=[5,9,14,18,23,28,33,40]
lines=json.loads((audio/'narration-lines.json').read_text())
cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(picture)]
filters=[];channels=[];counter=1
for i in range(8):
 file=audio/f'voice-{i+1:02}.mp3';assert file.exists(),file
 cmd+=['-i',str(file)]
 delay=int((starts[i]+.30)*1000);label=f'v{i}'
 filters.append(f'[{counter}:a]aresample=48000,volume=1.0,adelay={delay}:all=1[{label}]');channels.append(f'[{label}]');counter+=1
specs=[('quake',1.35,3.5),('siren',5.05,3.5),('power',15.10,2.7),('water',18.10,4.5),('aid',23.10,4.5),('quake',28.10,3.6),('train',33.15,5.0)]
for i,(name,start,duration) in enumerate(specs):
 file=audio/f'sfx-{name}.mp3';assert file.exists(),file
 cmd+=['-i',str(file)];label=f'e{i}';fade=max(0,duration-.3)
 filters.append(f'[{counter}:a]aresample=48000,atrim=duration={duration},afade=t=in:st=0:d=0.08,afade=t=out:st={fade}:d=0.3,volume=0.23,adelay={int(start*1000)}:all=1[{label}]');channels.append(f'[{label}]');counter+=1
music=audio/'sfx-music.mp3';assert music.exists();cmd+=['-stream_loop','1','-i',str(music)]
filters.append(f'[{counter}:a]aresample=48000,atrim=duration=40,afade=t=in:st=0:d=1,afade=t=out:st=37:d=3,volume=.085[bed]');channels.append('[bed]')
filters.append(''.join(channels)+f'amix=inputs={len(channels)}:duration=longest:normalize=0,atrim=duration=40,alimiter=limit=.92,loudnorm=I=-14:TP=-1.5:LRA=11[mix]')
video=out/'japan-earthquake-no-people.mp4'
cmd+=['-filter_complex',';'.join(filters),'-map','0:v:0','-map','[mix]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t','40','-movflags','+faststart',str(video)]
subprocess.run(cmd,check=True)
def timestamp(t):
 ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);sec,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{sec:02},{ms:03}'
subs=[]
for i,line in enumerate(lines):
 file=audio/f'voice-{i+1:02}.mp3';p=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(file)],capture_output=True,text=True,check=True);duration=float(p.stdout.strip());start=starts[i]+.3;end=min(ends[i]-.1,start+duration+.15)
 if start+duration>ends[i]-.05:raise RuntimeError(f'Narration {i+1} overruns its shot')
 subs.append(f'{i+1}\n{timestamp(start)} --> {timestamp(end)}\n{line}\n')
(out/'japan-earthquake-transcript.srt').write_text('\n'.join(subs),encoding='utf-8')
print('Video:',video)
print('Transcript:',out/'japan-earthquake-transcript.srt')
