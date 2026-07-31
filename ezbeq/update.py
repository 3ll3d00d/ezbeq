import logging

import requests
import semver

logger = logging.getLogger('ezbeq.update')

GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/3ll3d00d/ezbeq/releases/latest'


class GithubReleaseChecker:

    def __init__(self, url: str = GITHUB_LATEST_RELEASE_URL):
        self.__url = url

    def run(self, current_version: str) -> dict | None:
        try:
            r = requests.get(self.__url, timeout=10)
            if r.status_code != 200:
                logger.warning(f"Unable to check for updates, response is {r.status_code}")
                return None
            tag = r.json().get('tag_name')
        except Exception:
            logger.warning("Unable to check for updates, unexpected error", exc_info=True)
            return None
        if not tag:
            logger.warning("Unable to check for updates, no tag_name in latest release")
            return None
        try:
            latest = semver.parse_version_info(tag.lstrip('v'))
            current = semver.parse_version_info(current_version.lstrip('v'))
        except ValueError:
            logger.debug(f"Unable to compare versions {tag} vs {current_version}", exc_info=True)
            return None
        return {'latest_version': tag, 'update_available': latest > current}


class UpdateChecker:

    def __init__(self, current_version: str, check_interval: float, enabled: bool):
        self.__current_version = current_version
        self.__checker = GithubReleaseChecker()
        self.__latest_version: str | None = None
        self.__update_available: bool = False
        self.__enabled = enabled
        self.__task = None
        if self.__enabled:
            from twisted.internet import reactor, task
            logger.info(f'Scheduling update check to run every {check_interval}s')
            self.__task = task.LoopingCall(self.__check)
            self.__task.start(check_interval, now=True)
            reactor.addSystemEventTrigger('before', 'shutdown', self.stop)

    def stop(self):
        if self.__task is not None and self.__task.running:
            self.__task.stop()

    def __check(self):
        from twisted.internet import reactor
        reactor.callInThread(self.__do_check)

    def __do_check(self):
        result = self.__checker.run(self.__current_version)
        if result is not None:
            self.__latest_version = result['latest_version']
            self.__update_available = result['update_available']

    @property
    def result(self) -> dict | None:
        if self.__latest_version is None:
            return None
        return {'latest_version': self.__latest_version, 'update_available': self.__update_available}
