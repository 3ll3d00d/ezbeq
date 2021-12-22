import logging
from abc import ABC, abstractmethod, ABCMeta

import decimal
from typing import List

import math

ctx = decimal.Context()
ctx.prec = 17

logger = logging.getLogger('iir')


def float_to_str(f):
    """
    Convert the given float to a string without scientific notation or in the correct hex format.
    """
    d1 = ctx.create_decimal(repr(f))
    return format(d1, 'f')


class Biquad(ABC):

    def __init__(self, fs, freq, q, gain):
        self.fs = fs
        self.gain = round(float(gain), 3)
        self.freq = round(float(freq), 2)
        self.q = round(float(q), 4)
        self.w0 = 2.0 * math.pi * freq / fs
        self.cos_w0 = math.cos(self.w0)
        self.sin_w0 = math.sin(self.w0)
        self.alpha = self.sin_w0 / (2.0 * self.q)
        self.A = 10.0 ** (self.gain / 40.0)
        self.a, self.b = self._compute_coeffs()

    def __len__(self):
        return 1

    @abstractmethod
    def _compute_coeffs(self):
        pass

    def format_biquads(self):
        a = [f"{float_to_str(-x)}" for idx, x in enumerate(self.a) if idx != 0]
        b = [f"{float_to_str(x)}" for idx, x in enumerate(self.b)]
        return b + a

    def to_map(self):
        return {
            'type': self.__class__.__name__,
            'freq': self.freq,
            'gain': self.gain,
            'q': self.q,
            'biquads': {
                '96000': {
                    'b': self.format_biquads()[0:3],
                    'a': self.format_biquads()[3:]
                }
            }
        }

    def __repr__(self):
        return f"{self.print_params()}|{'`'.join(self.format_biquads())}"

    def print_params(self):
        return f"{self.__class__.__name__}|{self.freq}|{self.gain}|{self.q}"


class PeakingEQ(Biquad):
    '''
    H(s) = (s^2 + s*(A/Q) + 1) / (s^2 + s/(A*Q) + 1)

            b0 =   1 + alpha*A
            b1 =  -2*cos(w0)
            b2 =   1 - alpha*A
            a0 =   1 + alpha/A
            a1 =  -2*cos(w0)
            a2 =   1 - alpha/A
    '''

    def __init__(self, fs, freq, q, gain):
        super().__init__(fs, freq, q, gain)

    def _compute_coeffs(self):
        A = self.A
        a = [1.0 + self.alpha / A, -2.0 * self.cos_w0, 1.0 - self.alpha / A]
        b = [1.0 + self.alpha * A, -2.0 * self.cos_w0, 1.0 - self.alpha * A]
        return [a1 / a[0] for a1 in a], [b1 / a[0] for b1 in b]


class Shelf(Biquad, metaclass=ABCMeta):

    def __init__(self, fs, freq, q, gain, count):
        super().__init__(fs, freq, q, gain)
        self.count = count

    def __len__(self):
        return self.count

    def to_map(self):
        return {**super().to_map(), 'count': self.count}

    def print_params(self):
        return f"{super().print_params()}|{self.count}"


class LowShelf(Shelf):
    '''
    lowShelf: H(s) = A * (s^2 + (sqrt(A)/Q)*s + A)/(A*s^2 + (sqrt(A)/Q)*s + 1)

            b0 =    A*( (A+1) - (A-1)*cos(w0) + 2*sqrt(A)*alpha )
            b1 =  2*A*( (A-1) - (A+1)*cos(w0)                   )
            b2 =    A*( (A+1) - (A-1)*cos(w0) - 2*sqrt(A)*alpha )
            a0 =        (A+1) + (A-1)*cos(w0) + 2*sqrt(A)*alpha
            a1 =   -2*( (A-1) + (A+1)*cos(w0)                   )
            a2 =        (A+1) + (A-1)*cos(w0) - 2*sqrt(A)*alpha
    '''

    def __init__(self, fs, freq, q, gain, count=1):
        super().__init__(fs, freq, q, gain, count)

    def _compute_coeffs(self):
        A = self.A
        a = [
            (A + 1) + ((A - 1) * self.cos_w0) + (2.0 * math.sqrt(A) * self.alpha),
            -2.0 * ((A - 1) + ((A + 1) * self.cos_w0)),
            (A + 1) + ((A - 1) * self.cos_w0) - (2.0 * math.sqrt(A) * self.alpha)
        ]
        b = [
            A * ((A + 1) - ((A - 1) * self.cos_w0) + (2.0 * math.sqrt(A) * self.alpha)),
            2.0 * A * ((A - 1) - ((A + 1) * self.cos_w0)),
            A * ((A + 1) - ((A - 1) * self.cos_w0) - (2 * math.sqrt(A) * self.alpha))
        ]
        return [a1 / a[0] for a1 in a], [b1 / a[0] for b1 in b]


class HighShelf(Shelf):
    '''
    highShelf: H(s) = A * (A*s^2 + (sqrt(A)/Q)*s + 1)/(s^2 + (sqrt(A)/Q)*s + A)

                b0 =    A*( (A+1) + (A-1)*cos(w0) + 2*sqrt(A)*alpha )
                b1 = -2*A*( (A-1) + (A+1)*cos(w0)                   )
                b2 =    A*( (A+1) + (A-1)*cos(w0) - 2*sqrt(A)*alpha )
                a0 =        (A+1) - (A-1)*cos(w0) + 2*sqrt(A)*alpha
                a1 =    2*( (A-1) - (A+1)*cos(w0)                   )
                a2 =        (A+1) - (A-1)*cos(w0) - 2*sqrt(A)*alpha

    '''

    def __init__(self, fs, freq, q, gain, count=1):
        super().__init__(fs, freq, q, gain, count)

    def _compute_coeffs(self):
        A = self.A
        cos_w0 = self.cos_w0
        alpha = self.alpha
        a = [
            (A + 1) - ((A - 1) * cos_w0) + (2.0 * math.sqrt(A) * alpha),
            2.0 * ((A - 1) - ((A + 1) * cos_w0)),
            (A + 1) - ((A - 1) * cos_w0) - (2.0 * math.sqrt(A) * alpha)
        ]
        b = [
            A * ((A + 1) + ((A - 1) * cos_w0) + (2.0 * math.sqrt(A) * alpha)),
            -2.0 * A * ((A - 1) + ((A + 1) * cos_w0)),
            A * ((A + 1) + ((A - 1) * cos_w0) - (2.0 * math.sqrt(A) * alpha))
        ]
        return [a1 / a[0] for a1 in a], [b1 / a[0] for b1 in b]


def __extract_filters(file):
    import xml.etree.ElementTree as ET
    from collections import Counter

    ignore_vals = ['hex', 'dec']
    tree = ET.parse(file)
    root = tree.getroot()
    filts = {}
    for child in root:
        if child.tag == 'filter':
            if 'name' in child.attrib:
                current_filt = None
                filter_tokens = child.attrib['name'].split('_')
                (filt_type, filt_channel, filt_slot) = filter_tokens
                if len(filter_tokens) == 3:
                    if filt_type == 'PEQ':
                        if filt_channel not in filts:
                            filts[filt_channel] = {}
                        filt = filts[filt_channel]
                        if filt_slot not in filt:
                            filt[filt_slot] = {}
                        current_filt = filt[filt_slot]
                        for val in child:
                            if val.tag not in ignore_vals:
                                current_filt[val.tag] = val.text
                if current_filt is not None:
                    if 'bypass' in current_filt and current_filt['bypass'] == '1':
                        del filts[filt_channel][filt_slot]
                    elif 'boost' in current_filt and current_filt['boost'] == '0':
                        del filts[filt_channel][filt_slot]
    final_filt = None
    # if 1 and 2 are identical then throw one away
    if '1' in filts and '2' in filts:
        filt_1 = filts['1']
        filt_2 = filts['2']
        if filt_1 == filt_2:
            final_filt = list(filt_1.values())
        else:
            raise ValueError(f"Different input filters found in {file} - Input 1: {filt_1} - Input 2: {filt_2}")
    elif '1' in filts:
        final_filt = list(filts['1'].values())
    elif '2' in filts:
        final_filt = list(filts['2'].values())
    else:
        if len(filts.keys()) == 1:
            for k in filts.keys():
                final_filt = filts[k]
        else:
            raise ValueError(f"Multiple active filters found in {file} - {filts}")
    if final_filt is None:
        raise ValueError(f"No filters found in {file}")
    return Counter([tuple(f.items()) for f in final_filt])


def xml_to_filt(file, fs=96000, unroll=False) -> List[Biquad]:
    ''' Extracts a set of filters from the provided minidsp file '''
    filts = __extract_filters(file)
    output = []
    for filt_tup, count in filts.items():
        filt_dict = dict(filt_tup)
        if filt_dict['type'] == 'SL':
            for i in range(0, count if unroll is True else 1):
                filt = LowShelf(fs, float(filt_dict['freq']), float(filt_dict['q']), float(filt_dict['boost']),
                                count=1 if unroll is True else count)
                output.append(filt)
        elif filt_dict['type'] == 'SH':
            for i in range(0, count if unroll is True else 1):
                filt = HighShelf(fs, float(filt_dict['freq']), float(filt_dict['q']), float(filt_dict['boost']),
                                 count=1 if unroll is True else count)
                output.append(filt)
        elif filt_dict['type'] == 'PK':
            for i in range(0, count):
                filt = PeakingEQ(fs, float(filt_dict['freq']), float(filt_dict['q']), float(filt_dict['boost']))
                output.append(filt)
        else:
            logger.info(f"Ignoring unknown filter type {filt_dict}")
    return output
