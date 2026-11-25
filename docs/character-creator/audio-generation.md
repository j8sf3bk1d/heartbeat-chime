# Make voice clips and sound effects for Heartbeat

You can record audio yourself, use your operating system's speech tools, generate clips with a service such as ElevenLabs, or use prebuilt audio you have the rights to use. Heartbeat imports completed files locally; it does **not** need a provider account or API key to play them. There is no in-app ElevenLabs integration today.

## What works today

1. Write short lines for the intervals you use, and choose a voice and tone that fit the character. Consider several alternate takes for frequently recurring cues. Review and listen to a small batch before generating more.
2. Generate or record each line as a separate audio file, preferably with a descriptive filename. Keep the actual spoken words and delivery notes in a separate source document. Check the start and end for unwanted silence or clipping, and audition relative loudness.
3. In **Sounds**, name the collection, select the audio files and press **Import Clips**. Open **Browse Sounds** and optionally enter suggested minutes for each sound, then assign them under **Chimes**. For random takes, select multiple clips under **Volume, speech & multiple clips** and choose random or weighted random. See the [user guide](../user-guide.md#import-and-find-sounds).
4. Back up the resulting configuration and imported audio using **Settings → Full backup**. Keep original files as well.

A character JSON controls visuals only. Custom imported audio currently shows its **label** in the companion dialogue and uses the neutral expression; arbitrary written dialogue, per-line expressions, and grouping alternate takes by authored line ID are not part of the current import format. Replacing the character will not replace its sounds. See [the voice-pack design](voice-packs.md) for the planned richer model.

The built-in ElevenLabs voice bank already does map each line to a caption and expression. See the [character-to-voice workflow](emotion-voice-workflow.md) for the included bank, how to plan expression coverage and paired takes, and what source changes are currently needed for a new mapped bank.

For recognizable voices and shareable packs, use voices and source material for which you have the necessary rights and consent. Provider plan terms, costs, voice availability and output permissions may change; check them for your intended use.

## ElevenLabs: app workflow

1. In ElevenLabs, choose a permitted voice and a model available on your account. Their [v3/v4 audio-tag guidance](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-and-v4) describes directions such as `[mischievously]` and `[sighs]`; they affect delivery and should not be part of the text shown in Heartbeat.
2. Generate and audition a small set, then download the approved clips as separate files. For a themed sound effect, use [sound effects generation](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) or another audio tool. Watch usage and costs.
3. Import and assign the files as described above. No ElevenLabs credentials are stored in Heartbeat.

## ElevenLabs: agent or API workflow

An agent can generate local files when explicitly authorized to use the account and incur the expected usage charges. The owner supplies their own key through their environment or a private prompt. **Never search other projects for keys, put keys in the repository, include them in an asset pack, or print them in logs or chat.** Use a restricted key where supported, keep generated audio and source notes in a user-chosen folder, and report cost/usage and the actual validation performed. This project does not load `.env` files or contain an ElevenLabs client.

For a single smoke-test clip, the following Python standard-library example prompts privately for a key if `ELEVENLABS_API_KEY` is not already set. Supply a voice ID from your own account. It makes one billable request and writes one file under `~/Heartbeat-audio`; it does not import or assign the file. The [Create speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) documents the request and supported options. Verify the model is available to your account before running it.

```sh
python3 - <<'PY'
import getpass
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

key = os.environ.get('ELEVENLABS_API_KEY') or getpass.getpass('ElevenLabs API key: ')
voice_id = input('Voice ID: ').strip()
if not key or not voice_id:
    raise SystemExit('A key and voice ID are required.')
folder = Path.home() / 'Heartbeat-audio'
folder.mkdir(exist_ok=True)
output = folder / 'one-minute-example.mp3'
if output.exists():
    raise SystemExit(f'{output} already exists; choose another name before retrying.')
payload = json.dumps({
    'text': '[mischievously] Another minute gone. Shall we make the next one count?',
    'model_id': 'eleven_v3',
}).encode('utf-8')
request = Request(
    'https://api.elevenlabs.io/v1/text-to-speech/' + quote(voice_id, safe='') + '?output_format=mp3_44100_128',
    data=payload,
    headers={'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'},
    method='POST',
)
try:
    with urlopen(request, timeout=60) as response:
        audio = response.read()
except HTTPError as error:
    raise SystemExit(f'Generation failed: HTTP {error.code}. Check account access and model availability.')
except URLError:
    raise SystemExit('Generation failed: could not reach ElevenLabs.')
output.write_bytes(audio)
print(f'Saved {output}')
PY
```

For a larger project, agree on interval coverage, tone, number of takes and spending limit first. Keep a manifest mapping filenames to spoken lines and intended expressions, validate every output, and distinguish a generated audio collection from a future fully integrated character voice pack. Do not claim voice/expression mapping works for imported clips until it is implemented and tested.
