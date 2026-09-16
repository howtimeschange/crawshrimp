import pytest
from core import shenhui_shoe_observed as o,shenhui_shoe_packaging as s


def observed(**changes):
    return dict(candidate_id='I01',asset='shoe',count='single',side='outer',axis='horizontal',layout='na',
        complete=True,sole_full=False,lining=False,card=False,confidence=.95,evidence='完整外侧水平展示',**changes)


def test_horizontal_outer_cannot_fill_vertical_or_rear_slots():
    row=observed()
    assert o.matches(row,'yq3','婴童')
    assert not o.matches(row,'tmz3','婴童')
    assert not o.matches(row,'tmz4','婴童')


def test_pair_layout_and_full_sole_are_both_required():
    row={**observed(),'count':'pair','side':'mixed','layout':'front_sole','sole_full':True}
    assert o.matches(row,'tmz2','运动') and o.matches(row,'yq1','运动')
    row['layout']='floating'
    assert not o.matches(row,'tmz2','运动')
    assert not o.matches(row,'tmz1','运动')


def test_insole_is_never_accepted_as_outsole():
    row={**observed(),'asset':'insole','side':'sole','sole_full':True}
    assert not o.matches(row,'yq2','运动')


def test_card_can_obscure_part_of_shoe_but_not_fill_clean_slot():
    row={**observed(),'card':True,'complete':False}
    assert o.matches(row,'yx','婴童')
    assert not o.matches(row,'yq3','婴童')


def test_partial_final_response_can_include_other_known_slots_without_overwrite():
    observation=observed();ctx={'category':'婴童','ids':{'I01':'outer.jpg'}}
    response={'reviews':[dict(slot='yq3',candidate_id='I01',accepted=True,observation=observation),dict(slot='tmz1',candidate_id='not-requested',accepted=True)]}
    assert o._validate_final(response,{'yq3':['I01']},ctx)==({'yq3':'outer.jpg'}, {})
    response['reviews'].append(response['reviews'][0])
    with pytest.raises(s.ShoeSelectionError):o._validate_final(response,{'yq3':['I01']},ctx)


def test_observation_schema_rejects_string_booleans_and_out_of_range_confidence():
    with pytest.raises(s.ShoeSelectionError):o.validate_observation({**observed(),'complete':'true'})
    with pytest.raises(s.ShoeSelectionError):o.validate_observation({**observed(),'confidence':float('nan')})


def test_initial_observations_require_every_actual_image():
    response={'candidates':[observed()]}
    with pytest.raises(s.ShoeSelectionError):o._initial_rows(response,['I01','I02'])
    response['candidates'][0]['candidate_id']='1'
    assert o._initial_rows(response,['I01'])[0]['candidate_id']=='I01'


def test_standard_front_view_may_have_vertical_axis_without_being_main3():
    row={**observed(),'side':'front','axis':'vertical'}
    assert o.matches(row,'tmz5','婴童') and o.matches(row,'wpz5','婴童')
    assert not o.matches(row,'tmz3','婴童')


def test_full_outsole_contract_does_not_invent_a_one_shoe_requirement():
    row={**observed(),'count':'pair','side':'sole','sole_full':True}
    assert o.matches(row,'yq2','婴童')
    row['sole_full']=False
    assert not o.matches(row,'yq2','婴童')
