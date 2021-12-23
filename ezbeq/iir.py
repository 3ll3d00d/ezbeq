import logging
from abc import ABC, abstractmethod

import decimal

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

    def format_biquads(self) -> dict:
        a = {f"a{idx}": f"{float_to_str(-x)}" for idx, x in enumerate(self.a) if idx != 0}
        b = {f"b{idx}": f"{float_to_str(x)}" for idx, x in enumerate(self.b)}
        return {**b, **a}

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


class LowShelf(Biquad):
    '''
    lowShelf: H(s) = A * (s^2 + (sqrt(A)/Q)*s + A)/(A*s^2 + (sqrt(A)/Q)*s + 1)

            b0 =    A*( (A+1) - (A-1)*cos(w0) + 2*sqrt(A)*alpha )
            b1 =  2*A*( (A-1) - (A+1)*cos(w0)                   )
            b2 =    A*( (A+1) - (A-1)*cos(w0) - 2*sqrt(A)*alpha )
            a0 =        (A+1) + (A-1)*cos(w0) + 2*sqrt(A)*alpha
            a1 =   -2*( (A-1) + (A+1)*cos(w0)                   )
            a2 =        (A+1) + (A-1)*cos(w0) - 2*sqrt(A)*alpha
    '''

    def __init__(self, fs, freq, q, gain):
        super().__init__(fs, freq, q, gain)

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


class HighShelf(Biquad):
    '''
    highShelf: H(s) = A * (A*s^2 + (sqrt(A)/Q)*s + 1)/(s^2 + (sqrt(A)/Q)*s + A)

                b0 =    A*( (A+1) + (A-1)*cos(w0) + 2*sqrt(A)*alpha )
                b1 = -2*A*( (A-1) + (A+1)*cos(w0)                   )
                b2 =    A*( (A+1) + (A-1)*cos(w0) - 2*sqrt(A)*alpha )
                a0 =        (A+1) - (A-1)*cos(w0) + 2*sqrt(A)*alpha
                a1 =    2*( (A-1) - (A+1)*cos(w0)                   )
                a2 =        (A+1) - (A-1)*cos(w0) - 2*sqrt(A)*alpha

    '''

    def __init__(self, fs, freq, q, gain):
        super().__init__(fs, freq, q, gain)

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
