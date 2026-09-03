#!/usr/bin/env python3
"""Concatenate the source into the single self-contained nightward.html.

There is no bundler and no build step beyond this: d_shell.html holds the
markup, the styles and eight placeholders, and each one is replaced with the
matching module verbatim. That is the whole toolchain. Run it from anywhere:

    python3 src/build.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

PARTS = [
    ("__CORE__", "d_core.js"),   # palette, assets, terrain, balance table
    ("__GL__",   "d_gl.js"),     # the WebGL2 renderer
    ("__SND__",  "d_snd.js"),    # WebAudio
    ("__GAME__", "d_game.js"),   # simulation, input, drawing
    ("__LIB__",  "d_lib.js"),    # the in-game asset/balance library
    ("__MAP__",  "d_map.js"),    # map editor
    ("__NET__",  "d_net.js"),    # two-player peer connection
    ("__APP__",  "d_app.js"),    # screens and HUD
]

def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()

def main():
    out = read("d_shell.html")
    for token, name in PARTS:
        if token not in out:
            raise SystemExit("d_shell.html is missing the %s placeholder" % token)
        out = out.replace(token, read(name))
    dest = os.path.join(ROOT, "nightward.html")
    with open(dest, "w", encoding="utf-8") as f:
        f.write(out)
    print("built %s (%d bytes)" % (dest, len(out)))

if __name__ == "__main__":
    main()
