import logging
import time

from flask_restx import Namespace, Resource, reqparse

from ezbeq.catalogue import TWO_WEEKS_AGO_SECONDS, CatalogueProvider

logger = logging.getLogger('ezbeq.catalogue')

api = Namespace('1/whats-new', description='Returns recently added or updated BEQ entries')


@api.route('')
class WhatsNew(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']
        self.__parser = reqparse.RequestParser()
        self.__parser.add_argument('since', type=int)
        self.__parser.add_argument('limit', type=int, default=50)

    @api.param('since', 'Unix timestamp (seconds); entries created or updated after this time are returned. Defaults to 2 weeks ago.')
    @api.param('limit', 'Max results (default 50)')
    def get(self):
        args = self.__parser.parse_args()
        since = args.get('since')
        if since is None:
            since = int(time.time() - TWO_WEEKS_AGO_SECONDS)
        limit = args.get('limit')
        if limit is None:
            limit = 50
        return self.__provider.whats_new(since, limit)
