#!/usr/bin/env python3
"""
Simple Radiance RGBE (.hdr) -> PNG converter.
Requires: Pillow
Usage:
  pip install pillow
  python tools/hdr_to_png.py kloofendal_48d_partly_cloudy_puresky_1k.hdr out.png

This is a lightweight implementation of the RLE RGBE decoder and a Reinhard tone-mapper.
"""
import sys
from PIL import Image


def read_line(f):
    line = bytearray()
    while True:
        c = f.read(1)
        if not c:
            break
        if c == b'\n':
            break
        line += c
    return line.decode('ascii', errors='ignore')


def decode_hdr(filename):
    with open(filename, 'rb') as f:
        # read header
        header = []
        while True:
            line = read_line(f)
            if line is None:
                break
            if line.strip() == '':
                break
            header.append(line)

        # resolution line
        res_line = read_line(f)
        parts = res_line.strip().split()
        width = 0
        height = 0
        i = 0
        while i < len(parts) - 1:
            key = parts[i]; val = int(parts[i+1])
            if key in ('-Y', '+Y'):
                height = val
            if key in ('+X', '-X'):
                width = val
            i += 2

        if width == 0 or height == 0:
            raise ValueError('Invalid HDR resolution line: %r' % res_line)

        floats = [0.0] * (width * height * 3)

        # decode each scanline
        for y in range(height):
            # read 4 bytes
            r0 = f.read(1)
            if not r0:
                break
            r0 = r0[0]
            r1 = f.read(1)[0]
            r2 = f.read(1)[0]
            r3 = f.read(1)[0]
            if r0 != 2 or r1 != 2:
                raise ValueError('Unsupported HDR format (old RLE)')
            scanline_width = (r2 << 8) | r3
            if scanline_width != width:
                raise ValueError('HDR width mismatch')

            scanR = [0] * width
            scanG = [0] * width
            scanB = [0] * width
            scanE = [0] * width

            # read components
            for comp in range(4):
                i = 0
                while i < width:
                    val = f.read(1)[0]
                    if val > 128:
                        count = val - 128
                        v = f.read(1)[0]
                        for k in range(count):
                            if comp == 0:
                                scanR[i] = v
                            elif comp == 1:
                                scanG[i] = v
                            elif comp == 2:
                                scanB[i] = v
                            else:
                                scanE[i] = v
                            i += 1
                    else:
                        if comp == 0:
                            scanR[i] = val
                        elif comp == 1:
                            scanG[i] = val
                        elif comp == 2:
                            scanB[i] = val
                        else:
                            scanE[i] = val
                        i += 1

            # convert to floats
            for x in range(width):
                E = scanE[x]
                idx = (y * width + x) * 3
                if E == 0:
                    floats[idx] = floats[idx+1] = floats[idx+2] = 0.0
                else:
                    # value = (component / 256.0) * 2^(E - 128)
                    exp = E - 128
                    scale = (2.0 ** exp) / 256.0
                    floats[idx]   = scanR[x] * scale
                    floats[idx+1] = scanG[x] * scale
                    floats[idx+2] = scanB[x] * scale

    return width, height, floats


def tone_map_and_save(width, height, floats, outpath, exposure=0.6):
    # simple Reinhard tonemap + gamma 2.2
    buf = bytearray(width * height * 3)
    k = 0
    for i in range(width * height):
        r = floats[i*3] * exposure
        g = floats[i*3+1] * exposure
        b = floats[i*3+2] * exposure
        # Reinhard
        rr = r / (1.0 + r)
        gg = g / (1.0 + g)
        bb = b / (1.0 + b)
        # gamma 2.2
        rr = int(max(0, min(255, int((rr ** (1.0/2.2)) * 255.0))))
        gg = int(max(0, min(255, int((gg ** (1.0/2.2)) * 255.0))))
        bb = int(max(0, min(255, int((bb ** (1.0/2.2)) * 255.0))))
        buf[k] = rr; buf[k+1] = gg; buf[k+2] = bb
        k += 3

    img = Image.frombytes('RGB', (width, height), bytes(buf))
    img.save(outpath)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python tools/hdr_to_png.py input.hdr output.png')
        sys.exit(1)
    inp = sys.argv[1]
    out = sys.argv[2]
    print('Decoding', inp)
    w,h,floats = decode_hdr(inp)
    print('Decoded', w, 'x', h)
    tone_map_and_save(w,h,floats,out)
    print('Saved', out)
