from streetparade_embeddings.set_times import equal_set_times, format_clock, parse_clock, parse_window


def test_parse_clock():
    assert parse_clock("13:00") == 780
    assert parse_clock("18.08") == 1088
    assert parse_clock(" 9:30 ") == 570
    assert parse_clock(None) is None
    assert parse_clock("") is None
    assert parse_clock("nope") is None
    assert parse_clock("25:00") is None
    assert parse_clock("12:99") is None


def test_format_clock():
    assert format_clock(780) == "13:00"
    assert format_clock(1088) == "18:08"
    assert format_clock(90) == "01:30"


def test_parse_window():
    assert parse_window("13:00 - 18:00") == (780, 1080)
    assert parse_window("14:08 – 18:08") == (848, 1088)
    assert parse_window("22:00 — 02:00") == (1320, 120)
    assert parse_window(None) == (None, None)
    assert parse_window("all day") == (None, None)


def test_equal_set_times_contiguous_cover_window():
    slots = equal_set_times("13:00 - 18:00", 4)
    assert slots == [
        ("13:00", "14:15"),
        ("14:15", "15:30"),
        ("15:30", "16:45"),
        ("16:45", "18:00"),
    ]


def test_equal_set_times_single_artist():
    assert equal_set_times("15:00 - 17:00", 1) == [("15:00", "17:00")]


def test_equal_set_times_odd_minutes():
    slots = equal_set_times("14:08 - 18:08", 3)
    assert slots[0][0] == "14:08"
    assert slots[-1][1] == "18:08"


def test_equal_set_times_crosses_midnight():
    slots = equal_set_times("22:00 - 02:00", 2)
    assert slots[0] == ("22:00", "00:00")
    assert slots[1] == ("00:00", "02:00")


def test_equal_set_times_missing_window_returns_none():
    assert equal_set_times(None, 3) == [None, None, None]
    assert equal_set_times("all day", 2) == [None, None]


def test_equal_set_times_zero_count():
    assert equal_set_times("13:00 - 18:00", 0) == []
