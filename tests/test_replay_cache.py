from concurrent.futures import ThreadPoolExecutor

from server.replay_cache import ReplayCache


def test_replay_cache_rejects_reuse_and_expires_entries():
    cache = ReplayCache()
    assert cache.check_and_add(b"id", 0)
    assert not cache.check_and_add(b"id", 1)
    assert cache.check_and_add(b"id", 121)


def test_replay_cache_check_and_add_is_atomic():
    cache = ReplayCache()
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda _: cache.check_and_add(b"same", 10), range(100)))
    assert results.count(True) == 1
    assert results.count(False) == 99
