import logging
import xml.etree.ElementTree as et
from typing import Optional, List, Dict, Tuple

import requests

from ezbeq.device import SlotState
from ezbeq.catalogue import Catalogue
from ezbeq.config import Config
from ezbeq.device import Bridge

logger = logging.getLogger('ezbeq.jriver')

JRIVER_CHANNELS = [None, None, 'L', 'R', 'C', 'SW', 'SL', 'SR', 'RL', 'RR', None, 'U1', 'U2'] + [f"C{i + 9}" for i in
                                                                                                 range(24)]


class JRiver(Bridge):

    def __init__(self, cfg: Config):
        address: str = cfg.jriver_options['address']
        if not address:
            raise ValueError('No MCWS address for jriver')
        self.__zone_name: str = cfg.jriver_options['zone']
        cfg_auth = cfg.jriver_options.get('auth', None)
        auth = (cfg_auth['user'], cfg_auth['pass']) if cfg_auth else None
        secure = bool(cfg.jriver_options.get('secure', False))
        if not self.__zone_name:
            raise ValueError('No zone for jriver')
        self.__channels: str = ';'.join([str(JRIVER_CHANNELS.index(c)) for c in cfg.jriver_options['channels']])
        if not self.__channels:
            raise ValueError('No target channels for jriver')
        self.__peq_block: str = get_peq_key_name(int(cfg.jriver_options['block']) - 1)
        if not self.__peq_block:
            raise ValueError('No peq block for jriver')
        self.__mcws = MediaServer(address, auth, secure)

    def device_type(self) -> str:
        return 'jriver'

    def slot_state(self) -> List[SlotState]:
        return [SlotState(self.__zone_name)]

    def state(self) -> Optional[dict]:
        return {'active_slot': self.__zone_name}

    def activate(self, slot: str) -> None:
        raise NotImplementedError()

    def load_filter(self, slot: str, entry: Catalogue) -> None:
        mc_filts = [make_meta(entry.title, True)] \
                   + [convert_filter_to_mc_dsp(f, self.__channels) for f in entry.filters] \
                   + [make_meta(entry.title, False)]
        xml_filts = [filts_to_xml(f) for f in mc_filts]
        zone_id = self.__mcws.get_zone_id(self.__zone_name)
        current_config_txt = self.__mcws.get_dsp(zone_id)
        new_config_txt = include_filters_in_dsp(self.__peq_block, current_config_txt, xml_filts, replace=False)
        logger.info(new_config_txt)
        self.__mcws.set_dsp(zone_id, new_config_txt)

    def clear_filter(self, slot: str) -> None:
        zone_id = self.__mcws.get_zone_id(self.__zone_name)
        current_config_txt = self.__mcws.get_dsp(zone_id)
        new_config_txt = remove_beq_filter(self.__peq_block, current_config_txt)
        self.__mcws.set_dsp(zone_id, new_config_txt)

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        raise NotImplementedError()

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        raise NotImplementedError()

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        raise NotImplementedError()


def convert_filter_to_mc_dsp(filt: dict, target_channels: str) -> List[Dict[str, str]]:
    '''
    :param filt: filter values in catalogue form.
    :param target_channels: the channels to output to.
    :return: filter values in mc form.
    '''
    f_type = filt['type']
    if f_type == 'LowShelf':
        return make_shelf(target_channels, filt, False)
    elif f_type == 'HighShelf':
        return make_shelf(target_channels, filt, True)
    elif f_type == 'PeakingEQ':
        return [make_peak(target_channels, filt)]
    elif f_type == 'Gain':
        return [make_gain(target_channels, filt)]
    raise ValueError(f"Unknown filter type {f_type} in {filt}")


def make_peak(channels: str, vals: dict) -> Dict[str, str]:
    return {
        'Enabled': '1',
        'Slope': '12',
        'Q': f"{vals['q']}",
        'Type': '3',
        'Gain': f"{vals['gain']}",
        'Frequency': f"{vals['freq']}",
        'Channels': channels
    }


def make_shelf(channels: str, vals: dict, high: bool) -> List[Dict[str, str]]:
    filt_val = {
        'Enabled': '1',
        'Slope': '12',
        'Q': f"{q_to_s(vals['q'], vals['gain']):.12g}",
        'Type': '11' if high else '10',
        'Gain': f"{vals['gain']}",
        'Frequency': f"{vals['freq']}",
        'Channels': channels
    }
    count = int(vals.get('count', 1))
    return [filt_val] * count


def make_gain(channels: str, vals: dict) -> Dict[str, str]:
    return {
        'Enabled': '1',
        'Type': '4',
        'Gain': f"{vals['gain']}",
        'Channels': channels
    }


def make_meta(name: str, start: bool) -> List[Dict[str, str]]:
    suf = 'START' if start else 'END'
    return [{
        'Enabled': '1',
        'Type': '20',
        'Text': f"***BEQ_{suf}|{name}"
    }]


def q_to_s(q: float, gain: float):
    '''
    translates Q to S for a shelf filter.
    :param q: the Q.
    :param gain: the gain.
    :return: the S.
    '''
    return 1.0 / ((((1.0 / q) ** 2.0 - 2.0) / (
            (10.0 ** (gain / 40.0)) + 1.0 / (10.0 ** (gain / 40.0)))) + 1.0)


def xpath_to_key_data_value(key_name, data_name):
    '''
    an ET compatible xpath to get the value from a DSP config via the path /Preset/Key/Data/Value for a given key and
    data.
    :param key_name:
    :param data_name:
    :return:
    '''
    return f"./Preset/Key[@Name=\"{key_name}\"]/Data/Name[.=\"{data_name}\"]/../Value"


class NoFiltersError(ValueError):
    pass


def extract_filters(config_txt: str, key_name: str, allow_empty: bool = False):
    '''
    :param config_txt: the xml text.
    :param key_name: the filter key name.
    :param allow_empty: if true, create the missing filters element if it doesn't exist.
    :return: (root element, filter element)
    '''
    root = et.fromstring(config_txt)
    elements = root.findall(xpath_to_key_data_value(key_name, 'Filters'))
    if elements and len(elements) == 1:
        return root, elements[0]
    if allow_empty:
        parent_element = root.find(f"./Preset/Key[@Name=\"{key_name}\"]")
        data_element = et.Element('Data')
        name_element = et.Element('Name')
        name_element.text = 'Filters'
        data_element.append(name_element)
        value_element = et.Element('Value')
        value_element.text = ''
        data_element.append(value_element)
        parent_element.append(data_element)
        return root, value_element
    else:
        raise NoFiltersError(f"No Filters in {key_name} found in {config_txt}")


def filts_to_xml(vals: List[Dict[str, str]]) -> str:
    '''
    Formats key-value pairs into a jriver dsp config file compatible str fragment.
    :param vals: the key-value pairs.
    :return: the txt snippet.
    '''
    return ''.join(filt_to_xml(f) for f in vals)


def filt_to_xml(vals: Dict[str, str]) -> str:
    '''
    Converts a set of filter values to a jriver compatible xml fragment.
    :param vals: the values.
    :return: the xml fragment.
    '''
    items = [f"<Item Name=\"{k}\">{v}</Item>" for k, v in vals.items()]
    catted_items = '\n'.join(items)
    prefix = '<XMLPH version="1.1">'
    suffix = '</XMLPH>'
    txt_length = len(prefix) + len(''.join(items)) + len(suffix)
    new_line_len = (len(items) + 1) * 2
    total_len = txt_length + new_line_len
    xml_frag = f"({total_len}:{prefix}\n{catted_items}\n{suffix})"
    # print(f"{filter_classes_by_type[vals['Type']].__name__} ({vals['Type']}): {offset}")
    return xml_frag


def include_filters_in_dsp(peq_block_name: str, config_txt: str, xml_filts: List[str], replace: bool = True) -> str:
    '''
    :param peq_block_name: the peq block to process.
    :param config_txt: the dsp config in txt form.
    :param xml_filts: the filters to include.
    :param replace: if true, replace existing filters. if false, append.
    :return: the new config txt.
    '''
    if xml_filts:
        root, filt_element = extract_filters(config_txt, peq_block_name, allow_empty=True)
        # before_value, after_value, filt_section = extract_value_section(config_txt, self.__block)
        # separate the tokens, which are in (TOKEN) blocks, from within the Value element
        if filt_element.text:
            filt_fragments = [v + ')' for v in filt_element.text.split(')') if v]
            if len(filt_fragments) < 2:
                raise ValueError('Invalid input file - Unexpected <Value> format')
        else:
            filt_fragments = ['(1:1)', '(2:0)']
        # find the filter count and replace it with the new filter count
        new_filt_count = sum([x.count('<XMLPH version') for x in xml_filts])
        if not replace:
            new_filt_count = int(filt_fragments[1][1:-1].split(':')[1]) + new_filt_count
        filt_fragments[1] = f"({len(str(new_filt_count))}:{new_filt_count})"
        # append the new filters to any existing ones or replace
        if replace:
            new_filt_section = ''.join(filt_fragments[0:2]) + ''.join(xml_filts)
        else:
            new_filt_section = ''.join(filt_fragments) + ''.join(xml_filts)
        # replace the value block in the original string
        filt_element.text = new_filt_section
        config_txt = et.tostring(root, encoding='UTF-8', xml_declaration=True).decode('utf-8')
        return config_txt
    else:
        return config_txt


def remove_beq_filter(peq_block_name: str, config_txt: str) -> str:
    root, filt_element = extract_filters(config_txt, peq_block_name, allow_empty=True)
    # before_value, after_value, filt_section = extract_value_section(config_txt, self.__block)
    # separate the tokens, which are in (TOKEN) blocks, from within the Value element
    if filt_element.text:
        filt_fragments = [v + ')' for v in filt_element.text.split(')') if v]
        if len(filt_fragments) < 2:
            raise ValueError('Invalid input file - Unexpected <Value> format')
        individual_filters = [d for d in [item_to_dicts(f) for f in filt_fragments[2:]] if d]
        start_beq_idx = -1
        end_beq_idx = -1
        beq_name = ''
        for i, t in enumerate(individual_filters):
            if start_beq_idx > -1 and end_beq_idx > -1:
                break
            f = t[0]
            if f.get('Type', '') == '20':
                txt = f.get('Text', '')
                if txt.startswith('***BEQ_START|'):
                    start_beq_idx = i
                    beq_name = txt[13:]
                if txt.startswith('***BEQ_END|'):
                    end_beq_idx = i
                    if txt[11:] != beq_name:
                        raise ValueError(f'Unexpected BEQ names {beq_name} vs {txt[11:]}')
        if start_beq_idx > -1:
            if end_beq_idx > start_beq_idx:
                new_filts = [f[1] for idx, f in enumerate(individual_filters) if idx < start_beq_idx or idx > end_beq_idx]
                new_filt_count = len(new_filts)
                filt_fragments[1] = f"({len(str(new_filt_count))}:{new_filt_count})"
                filt_element.text = ''.join(filt_fragments[0:2]) + ''.join(new_filts)
                config_txt = et.tostring(root, encoding='UTF-8', xml_declaration=True).decode('utf-8')
                return config_txt
            else:
                raise ValueError(f'Unexpected BEQ format {end_beq_idx} <= {start_beq_idx}')
        else:
            return config_txt

    else:
        return config_txt


def get_peq_key_name(block):
    '''
    :param block: 0 or 1.
    :return: the PEQ key name.
    '''
    if block == 0:
        return 'Parametric Equalizer'
    elif block == 1:
        return 'Parametric Equalizer 2'
    else:
        raise ValueError(f"Unknown PEQ block {block}")


class MediaServer:

    def __init__(self, ip: str, auth: Optional[Tuple[str, str]] = None, secure: bool = False):
        self.__ip = ip
        self.__auth = auth
        self.__secure = secure
        self.__base_url = f"http{'s' if secure else ''}://{ip}/MCWS/v1"
        self.__token = None

    def as_dict(self) -> dict:
        return {self.__ip: (self.__auth, self.__secure)}

    def __repr__(self):
        suffix = f" [{self.__auth[0]}]" if self.__auth else ' [Unauthenticated]'
        return f"{self.__ip}{suffix}"

    def authenticate(self) -> bool:
        self.__token = None
        url = f"{self.__base_url}/Authenticate"
        r = requests.get(url, auth=self.__auth, timeout=(1, 5))
        if r.status_code == 200:
            response = et.fromstring(r.content)
            if response:
                r_status = response.attrib.get('Status', None)
                if r_status == 'OK':
                    for item in response:
                        if item.attrib['Name'] == 'Token':
                            self.__token = item.text
        if self.connected:
            return True
        else:
            raise MCWSError('Authentication failure', r.url, r.status_code, r.text)

    @property
    def connected(self) -> bool:
        return self.__token is not None

    def get_zone_id(self, zone_name: str) -> str:
        self.__auth_if_required()
        r = requests.get(f"{self.__base_url}/Playback/Zones", params={'Token': self.__token}, timeout=(1, 5))
        if r.status_code == 200:
            response = et.fromstring(r.content)
            if response:
                r_status = response.attrib.get('Status', None)
                if r_status == 'OK':
                    zones = {}
                    remote_zones = []
                    for child in response:
                        if child.tag == 'Item' and 'Name' in child.attrib:
                            attrib = child.attrib['Name']
                            if attrib.startswith('ZoneName'):
                                item_idx = attrib[8:]
                                if item_idx in zones:
                                    zones[item_idx]['name'] = child.text
                                else:
                                    zones[item_idx] = {'name': child.text}
                            elif attrib.startswith('ZoneID'):
                                item_idx = attrib[6:]
                                if item_idx in zones:
                                    zones[item_idx]['id'] = child.text
                                else:
                                    zones[item_idx] = {'id': child.text}
                            elif attrib.startswith('ZoneDLNA'):
                                if child.text == '1':
                                    remote_zones.append(attrib[8:])
                    return next(v['id'] for k, v in zones.items() if k not in remote_zones and v['name'] == zone_name)
        raise MCWSError('No zones loaded', r.url, r.status_code, r.text)

    def __auth_if_required(self):
        if not self.connected:
            self.authenticate()

    def get_dsp(self, zone_id: str) -> Optional[str]:
        self.__auth_if_required()
        r = requests.get(f"{self.__base_url}/Playback/SaveDSPPreset",
                         params={'Token': self.__token, 'Zone': zone_id, 'ZoneType': 'ID'},
                         timeout=(1, 5))
        if r.status_code == 200:
            response = et.fromstring(r.text)
            if response:
                if response.tag == 'DSP':
                    return r.text
                elif response.tag == 'Response':
                    r_status = response.attrib.get('Status', None)
                    if r_status == 'OK':
                        for child in response:
                            if child.tag == 'Item' and 'Name' in child.attrib and child.attrib['Name'] == 'Preset':
                                return child.text
        raise MCWSError('No DSP loaded', r.url, r.status_code, r.text)

    def set_dsp(self, zone_id: str, dsp: str) -> bool:
        self.__auth_if_required()
        dsp = dsp.replace('\n', '\r\n')
        if not dsp.endswith('\r\n'):
            dsp = dsp + '\r\n'
        r = requests.post(f"{self.__base_url}/Playback/LoadDSPPreset",
                          params={'Token': self.__token, 'Zone': zone_id, 'ZoneType': 'ID'},
                          files={'Name': (None, dsp)},
                          timeout=(1, 5))
        if r.status_code == 200:
            logger.info(f"LoadDSPPreset/{zone_id} success {r.url}")
            loaded_dsp = self.get_dsp(zone_id)
            if self.__compare_xml(et.fromstring(dsp), et.fromstring(loaded_dsp)):
                return True
            else:
                raise DSPMismatchError(zone_id, dsp, loaded_dsp)
        else:
            raise MCWSError('DSP not set', r.url, r.status_code, r.text)

    @staticmethod
    def __compare_xml(x1, x2):
        if x1.tag != x2.tag:
            return False
        for name, value in x1.attrib.items():
            if x2.attrib.get(name) != value:
                return False
        for name in x2.attrib:
            if name not in x1.attrib:
                return False
        if not MediaServer.__text_compare(x1.text, x2.text):
            return False
        if not MediaServer.__text_compare(x1.tail, x2.tail):
            return False
        cl1 = list(x1)
        cl2 = list(x2)
        if len(cl1) != len(cl2):
            return False
        i = 0
        for c1, c2 in zip(cl1, cl2):
            i += 1
            if not MediaServer.__compare_xml(c1, c2):
                return False
        return True

    @staticmethod
    def __text_compare(t1, t2):
        if not t1 and not t2:
            return True
        if t1 == '*' or t2 == '*':
            return True
        return (t1 or '').strip() == (t2 or '').strip()


class DSPMismatchError(Exception):

    def __init__(self, zone_id: str, expected: str, actual):
        super().__init__(f"Mismatch in DSP loaded to {zone_id}")
        self.zone_id = zone_id
        self.expected = expected
        self.actual = actual


class MCWSError(Exception):

    def __init__(self, msg: str, url: str, status_code: int, resp: Optional[str] = None):
        super().__init__(msg)
        self.msg = msg
        self.url = url
        self.status_code = status_code
        self.resp = resp


def item_to_dicts(frag) -> Optional[Tuple[Dict[str, str], str]]:
    idx = frag.find(':')
    if idx > -1:
        peq_xml = frag[idx+1:-1]
        vals = {i.attrib['Name']: i.text for i in et.fromstring(peq_xml).findall('./Item')}
        if 'Enabled' in vals:
            if vals['Enabled'] != '0' and vals['Enabled'] != '1':
                vals['Enabled'] = '1'
        else:
            vals['Enabled'] = '0'
        return vals, frag
    return None
