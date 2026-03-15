import os

import pytest
import yaml
from camilladsp import create_cfg_for_entry, get_filter_type
from catalogue import CatalogueEntry, TITLE, DIGEST, FILTERS, YEAR

__location__ = os.path.realpath(os.path.join(os.getcwd(), os.path.dirname(__file__)))


@pytest.mark.parametrize("base_cfg_name",
                         ["multi3", "multi3_existing_gain", "multi3_existing_gain_partial_filters", "multi3_with_beq"])
@pytest.mark.parametrize("mv_adjust", [-5.0, 0.0])
@pytest.mark.parametrize("has_entry", [True, False])
def test_add_remove_filters(base_cfg_name: str, mv_adjust: float, has_entry: bool):
    input_filters = [
        {
            'type': 'LowShelf',
            'freq': 20.0,
            'gain': 5.0,
            'q': 0.8,
        },
        {
            'type': 'HighShelf',
            'freq': 40.0,
            'gain': 2.0,
            'q': 0.7,
        },
        {
            'type': 'PeakingEQ',
            'freq': 60.0,
            'gain': 2.0,
            'q': 2.0,
        }
    ] if has_entry else []
    default_filter = {
        'type': 'LowShelf',
        'freq': 20.0,
        'gain': 0.0,
        'q': 1.0,
    }
    e = CatalogueEntry('1', {
        TITLE: 'Test Entry',
        DIGEST: '1234567890',
        FILTERS: input_filters,
        YEAR: 2023
    }) if has_entry else None
    with open(os.path.join(__location__, f"{base_cfg_name}.yaml"), 'r') as yml:
        base_cfg = yaml.load(yml, Loader=yaml.FullLoader)
    with open(os.path.join(__location__, "multi3_with_beq.yaml"), 'r') as yml:
        expected_cfg = yaml.load(yml, Loader=yaml.FullLoader)

    beq_channels = [2, 3]
    new_cfg = create_cfg_for_entry(e, base_cfg, beq_channels, mv_adjust, False)

    for n in ['devices', 'mixers']:
        assert new_cfg[n] == expected_cfg[n]

    new_filters = new_cfg['filters']
    for i in range(10):
        f = new_filters[f'BEQ_{i}']
        assert f
        assert f['type'] == 'Biquad'
        expected_filter = input_filters[i] if i < len(input_filters) else default_filter
        assert f['parameters'] == {
            'type': get_filter_type(expected_filter),
            'freq': expected_filter['freq'],
            'gain': expected_filter['gain'],
            'q': expected_filter['q'],
        }
    for i in beq_channels:
        f = new_filters[f'BEQ_Gain_{i}']
        assert f
        assert f['type'] == 'Gain'
        assert f['parameters']['mute'] == False
        assert f['parameters']['gain'] == mv_adjust

    new_pipeline_filters = [f for f in new_cfg['pipeline'] if f['type'] == 'Filter']
    assert new_pipeline_filters

    for i in range(10):
        target_name = f'BEQ_{i}'
        matches = [f for f in new_pipeline_filters if target_name in f['names']]
        assert matches
        channels = [c for f in matches for c in f['channels'] if c in beq_channels]
        assert sorted(channels) == sorted(beq_channels)

    for c in beq_channels:
        target_name = f'BEQ_Gain_{c}'
        matches = [f for f in new_pipeline_filters if target_name in f['names']]
        assert len(matches) == 1
        match = matches[0]
        assert c in match['channels']
        assert len([n for n in match['names'] if n == target_name]) == 1
