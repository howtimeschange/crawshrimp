"""Pixel-exact tests for the low-memory background flood fill."""
import random
import unittest
from collections import deque
from PIL import Image, ImageDraw
from core.shenhui_shoe_packaging import _replace_border_background


def reference(image, target, tolerance=18):
    width, height = image.size
    pixels = image.load()
    edge = [pixels[x, y] for x in range(width) for y in (0, height - 1)]
    edge += [pixels[x, y] for y in range(height) for x in (0, width - 1)]
    source = tuple(sorted(p[c] for p in edge)[len(edge) // 2] for c in range(3))
    output = image.copy()
    queue = deque((x, y) for x in range(width) for y in (0, height - 1))
    queue.extend((x, y) for y in range(height) for x in (0, width - 1))
    visited = set()
    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or not (0 <= x < width and 0 <= y < height):
            continue
        visited.add((x, y))
        if max(abs(pixels[x, y][c] - source[c]) for c in range(3)) > tolerance:
            continue
        output.putpixel((x, y), target)
        queue.extend(((x-1,y), (x+1,y), (x,y-1), (x,y+1)))
    return output


class ShoeBackgroundTests(unittest.TestCase):
    def compare(self, image, tolerance=18):
        original = image.tobytes()
        target = (219, 219, 219)
        actual = _replace_border_background(image, target, tolerance=tolerance)
        self.assertEqual(actual.tobytes(), reference(image, target, tolerance).tobytes())
        self.assertEqual(image.tobytes(), original)

    def test_random_masks_and_channel_thresholds(self):
        rng = random.Random(19276)
        for width, height in ((1, 1), (1, 53), (47, 1), (31, 29), (60, 50)):
            for tolerance in (-1, 0, 18, 255):
                for _ in range(5):
                    im = Image.new('RGB', (width, height))
                    im.putdata([tuple(rng.choice((10, 181, 182, 200, 218, 219, 240)) for _ in range(3)) for _ in range(width*height)])
                    with self.subTest(size=im.size, tolerance=tolerance):
                        self.compare(im, tolerance)

    def test_enclosed_holes_diagonal_contact_and_narrow_corridors(self):
        im = Image.new('RGB', (101, 99), (240, 240, 240))
        draw = ImageDraw.Draw(im)
        draw.rectangle((10, 10, 90, 90), fill=(20, 30, 40))
        draw.rectangle((20, 20, 80, 80), fill=(240, 240, 240))
        for x in range(11, 30):
            draw.point((x, x), fill=(240, 240, 240))
        self.compare(im)
        draw.line((50, 0, 50, 35), fill=(240, 240, 240))
        self.compare(im)

    def test_many_connected_runs(self):
        im = Image.new('RGB', (103, 97), (240, 240, 240))
        draw = ImageDraw.Draw(im)
        for y in range(3, 94, 3):
            draw.line((3, y, 98, y), fill=(30, 40, 50))
        self.compare(im)
