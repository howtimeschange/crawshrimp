import hashlib
from pathlib import Path
from PIL import Image
import pytest
from core.mini_bala_reference_review import review_against_reference

CODE='230426107212'

def test_verifier_never_fills_missing_images_or_rewrites_output(tmp_path):
    reference=tmp_path/'reference'/CODE;reference.mkdir(parents=True)
    output=tmp_path/'result'/CODE;output.mkdir(parents=True)
    Image.new('RGB',(200,200),'blue').save(reference/'ya.jpg')
    Image.new('RGB',(200,200),'red').save(reference/'manual.png')
    (output/'ya.jpg').write_bytes((reference/'ya.jpg').read_bytes())
    before=hashlib.sha256((output/'ya.jpg').read_bytes()).hexdigest()
    result=review_against_reference(data_rows=[{'款号':CODE}],reference_dir=reference.parent,output_root=output.parent,log=lambda _:None)
    assert result['missing']==[CODE+'/manual.png']
    assert result['reference_images_copied']==0
    assert not (output/'manual.png').exists()
    assert hashlib.sha256((output/'ya.jpg').read_bytes()).hexdigest()==before
    # Verification is repeatable and does not create a second corrected package.
    review_against_reference(data_rows=[{'款号':CODE}],reference_dir=reference.parent,output_root=output.parent,log=lambda _:None)
    assert not (output.parent/'按人工标准复核').exists()
    with pytest.raises(ValueError,match='不同目录'):
        review_against_reference(data_rows=[{'款号':CODE}],reference_dir=reference.parent,output_root=reference.parent,log=lambda _:None)
