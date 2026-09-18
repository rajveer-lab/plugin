import struct
import zlib
import os

def make_png(width, height, color):
    # color is (R, G, B, A)
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0)  # filter type 0
        for x in range(width):
            # Draw a shield-like gradient or border
            dx = abs(x - width / 2) / (width / 2)
            dy = (y - height / 2) / (height / 2)
            if (dx*dx + dy*dy) <= 0.8:
                raw_data.extend(color)
            else:
                raw_data.extend((15, 23, 42, 255)) # dark blue background

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(bytes(raw_data)))
    iend = chunk(b"IEND", b"")
    return header + ihdr + idat + iend

if __name__ == "__main__":
    os.makedirs("extension/icons", exist_ok=True)
    for size in [16, 32, 48, 128]:
        png_bytes = make_png(size, size, (56, 189, 248, 255)) # Cyan shield color #38bdf8
        with open(f"extension/icons/icon{size}.png", "wb") as f:
            f.write(png_bytes)
    print("Icons created successfully.")
