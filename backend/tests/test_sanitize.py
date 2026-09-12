from wassily.engine.sanitize import SanitizedLore, sanitize_lore


def test_blank_lore():
    assert sanitize_lore(None) == SanitizedLore("", False, None)
    assert sanitize_lore("   ") == SanitizedLore("", False, None)


def test_strips_links_and_invisible_characters():
    r = sanitize_lore("Hello​ world https://x.io/a  and www.foo.com  now﻿")
    assert r == SanitizedLore("Hello world and now", False, None)


def test_blocklisted_words_withhold_the_display_only():
    r = sanitize_lore("Survivor of three rugs, holy shit.")
    assert r.withheld and r.display == "" and r.reason == "blocklist"


def test_blocklist_matches_whole_words():
    assert not sanitize_lore("shitake mushrooms").withheld


def test_display_is_capped():
    assert len(sanitize_lore("a" * 500).display) == 280
