import linecache
import logging
import time
import tracemalloc

from flask_restx import Resource, Namespace

logger = logging.getLogger('ezbeq.diagnostics')

api = Namespace('1/diagnostics', description='Triggers a dump of some diagnostic info to th elog')


@api.route('')
class Diagnostics(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def get(self):
        before = time.time()
        logger.info(f'Generating diagnostics')
        snapshot = tracemalloc.take_snapshot()
        current, peak = tracemalloc.get_traced_memory()

        diag = {
            'stats': {
                'current': round(current / 1024 / 1024, 3),
                'peak': round(peak / 1024 / 1024, 3)
            },
            'top': self.__top(snapshot),
            'traceback': self.__traceback(snapshot)
        }
        after = time.time()
        from ezbeq import to_millis
        logger.info(f'Generated diagnostics in {to_millis(before, after)}ms')
        return diag

    @staticmethod
    def __traceback(snapshot):
        top_stats = snapshot.statistics('traceback')

        # pick the biggest memory block
        vals = []
        for stat in top_stats:
            if stat.size > (1024 * 512):
                val = {
                    'count': stat.count,
                    'size': round(stat.size / 1024 / 1024, 3),
                }
                lines = []
                for line in stat.traceback.format():
                    lines.append(f'{line}')
                val['lines'] = lines
                vals.append(val)
        return vals

    @staticmethod
    def __top(snapshot, key_type='lineno', limit=10):
        snapshot = snapshot.filter_traces((
            tracemalloc.Filter(False, "<frozen importlib._bootstrap>"),
            tracemalloc.Filter(False, "<unknown>"),
        ))
        top_stats = snapshot.statistics(key_type)

        tops = []
        for index, stat in enumerate(top_stats[:limit], 1):
            frame = stat.traceback[0]
            tops.append({
                'filename': frame.filename,
                'lineno': frame.lineno,
                'size': round(stat.size / 1024 / 1024, 3),
                'line': linecache.getline(frame.filename, frame.lineno).strip()
            })
        remainder = {}
        other = top_stats[limit:]
        if other:
            size = sum(stat.size for stat in other)
            remainder['count'] = len(other)
            remainder['size'] = round(size / 1024 / 1024, 3)
        total = sum(stat.size for stat in top_stats)
        return {
            'bytes': round(total / 1024 / 1024, 3),
            'tops': tops,
            'remainder': remainder
        }
