# claude-video attribution

`frames.py` and `transcribe.py` are derived from
https://github.com/bradautomates/claude-video at
`83da59fa78c3eee9e20f515fe75c438bb5166efd` (MIT, Bradley Bonanno).
The accompanying LICENSE is retained. Tzudong's adapter owns bounded local
execution, input/output isolation, privacy projection, receipts and cache use.
No upstream installer, credentials loader, agent instructions or cloud
transcription clients are installed or invoked.

Local modifications to `frames.py`: bounded subprocess timeouts (15 seconds
for probing, 60 seconds for extraction) and `-fps_mode vfr` in place of the
removed `-vsync vfr` option for the installed ffmpeg runtime.
