def setup():
    # trivial setup
    pass


def time_trivial(loops=100000):
    s = 0
    for i in range(loops):
        s += i
    return s
