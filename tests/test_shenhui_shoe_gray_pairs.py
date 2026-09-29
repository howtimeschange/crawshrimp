"""Gray export variants need both producer-family and visual evidence."""
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image, ImageDraw
from core.shenhui_shoe_fast import _gray_mates
from core import shenhui_shoe_packaging as p


def test_same_export_family_tolerates_jpeg_mask_edges_but_not_changed_product():
    names=['GUDG2757 拷贝.jpg','GUDG2757.jpg','unrelated.jpg']
    ctx={'entries':{n:{'path':n} for n in names},'ids':{n:n for n in names}}
    def signature(color):
        image=Image.new('RGB',(160,160),'white')
        mask=Image.new('L',(160,160))
        ImageDraw.Draw(image).rectangle((30,30,120,120),fill=color)
        ImageDraw.Draw(mask).rectangle((30,30,120,120),fill=255)
        return image,mask
    def fact(context,path,kind):
        if kind=='pose':
            return SimpleNamespace(valid=True,background_luma=255 if path==names[0] else 242,
                                   aspect_ratio=1.08,bounding_coverage=.20)
        return signature('red')
    with patch('core.shenhui_shoe_fast._source_visual_fact',side_effect=fact), patch.object(p,'_binary_pose_distance',return_value=.034):
        assert _gray_mates(ctx,names[0])==[names[1]]
        with patch.object(p,'_same_background_foreground_pixel_match',return_value=.2):
            assert _gray_mates(ctx,names[0])==[]
        with patch.object(p,'_binary_pose_distance',return_value=.10):
            assert _gray_mates(ctx,names[0])==[]


def test_gray_mate_requires_strong_pixels_when_background_changes_mask():
    names = ['white.jpg', 'gray.jpg', 'different-pose.jpg']
    ctx = {'entries': {n: {'path': n} for n in names}, 'ids': {n: n for n in names},
           'strong_gray_pair_evidence': True}
    def fact(context, path, kind):
        if kind == 'pose':
            return SimpleNamespace(valid=True, background_luma=255 if path == names[0] else 242,
                                   aspect_ratio=1.4 if path == names[0] else 1.518,
                                   bounding_coverage=.24)
        return path
    with patch('core.shenhui_shoe_fast._source_visual_fact', side_effect=fact), \
         patch.object(p, '_binary_pose_distance', return_value=.065), \
         patch.object(p, '_same_background_foreground_pixel_match',
                      side_effect=lambda a,b: .86 if b == 'gray.jpg' else .72):
        assert _gray_mates(ctx, names[0]) == ['gray.jpg']
        with patch.object(p, '_binary_pose_distance', return_value=.10):
            assert _gray_mates(ctx, names[0]) == []


def test_pale_export_pair_needs_tight_geometry_and_pixels():
    names = ['GUDG1239 拷贝.jpg', 'yk2.jpg', 'different.jpg']
    ctx = {'entries': {n: {'path': n} for n in names}, 'ids': {n: n for n in names},
           'strong_gray_pair_evidence': True}
    def fact(context, path, kind):
        if kind == 'pose':
            return SimpleNamespace(valid=True, background_luma=255 if path == names[0] else 242,
                                   aspect_ratio=1.6667 if path == names[0] else 1.7647,
                                   bounding_coverage=.1974 if path == names[0] else .1864)
        return path
    with patch('core.shenhui_shoe_fast._source_visual_fact', side_effect=fact), \
         patch.object(p, '_binary_pose_distance', return_value=.0467), \
         patch.object(p, '_same_background_foreground_pixel_match',
                      side_effect=lambda a,b: .8305 if b == names[1] else .72):
        assert _gray_mates(ctx, names[0]) == [names[1]]
        with patch.object(p, '_same_background_foreground_pixel_match', return_value=.79):
            assert _gray_mates(ctx, names[0]) == []
        with patch.object(p, '_binary_pose_distance', return_value=.06):
            assert _gray_mates(ctx, names[0]) == []
        ctx['strong_gray_pair_evidence'] = False
        assert _gray_mates(ctx, names[0]) == []
