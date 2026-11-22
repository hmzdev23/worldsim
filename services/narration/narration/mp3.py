"""MP3 duration from frame headers (stdlib only, no ffprobe needed).

Walks every MPEG audio frame and adds up its samples, skipping a leading ID3v2
tag. Works for constant and variable bitrate files.
"""

from __future__ import annotations

_BITRATES = {  # kbps, index 1..14, by (MPEG version group, layer)
    ("1", 1): (32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448),
    ("1", 2): (32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384),
    ("1", 3): (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
    ("2", 1): (32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256),
    ("2", 2): (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
    ("2", 3): (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
}
_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}  # by version bits


def _frame(b: bytes, i: int):
    """(frame_bytes, samples, sample_rate) for a valid header at i, else None."""
    if i + 4 > len(b) or b[i] != 0xFF or (b[i + 1] & 0xE0) != 0xE0:
        return None
    version = (b[i + 1] >> 3) & 3  # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    layer = 4 - ((b[i + 1] >> 1) & 3)  # 1..3
    bitrate_idx = b[i + 2] >> 4
    rate_idx = (b[i + 2] >> 2) & 3
    if version == 1 or layer == 4 or bitrate_idx in (0, 15) or rate_idx == 3:
        return None
    padding = (b[i + 2] >> 1) & 1
    bitrate = _BITRATES[("1" if version == 3 else "2", layer)][bitrate_idx - 1] * 1000
    rate = _RATES[version][rate_idx]
    if layer == 1:
        return (12 * bitrate // rate + padding) * 4, 384, rate
    samples = 1152 if (layer == 2 or version == 3) else 576
    return samples // 8 * bitrate // rate + padding, samples, rate


def mp3_duration(data: bytes) -> float:
    """Seconds of audio in an MP3. Raises ValueError if no frames are found."""
    i = 0
    if data[:3] == b"ID3" and len(data) >= 10:
        size = (data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F)
        i = 10 + size + (10 if data[5] & 0x10 else 0)
    seconds, frames = 0.0, 0
    while i < len(data):
        f = _frame(data, i)
        if f is None or f[0] <= 0:
            i += 1  # resync past junk or a trailing tag
            continue
        size, samples, rate = f
        seconds += samples / rate
        frames += 1
        i += size
    if not frames:
        raise ValueError("no MPEG audio frames found")
    return seconds
