#!/usr/bin/env python3
"""Checked hooks for HTTP disc reads in the pinned PlayStation app only."""
import hashlib

SOURCE_SHA256 = 'e5c2376e4977e20a2216c6383b7449bd7589a5ee42d24f968ebd8c4531d8b00e'


def patch_psx_stream(bundle):
    if hashlib.sha256(bundle.encode()).hexdigest() != SOURCE_SHA256:
        raise ValueError('PlayStation bundle changed; revalidate streaming hooks')
    replacements = {
        'createEmulator(e,t){return new l(e,t)}':
            'createEmulator(e,t){return window.WrcadPsxStreaming.attach(this,new l(e,t))}',
        'return d?d.fetch():null':
            'return d?window.WrcadPsxStreaming.fetchDisc(d,t,h):null',
        'var e=o.open(i,"a");t.isWriteEmptyRomEnabled()||o.write(e,t.romBytes,0,t.romBytes.length,0,!0),o.close(e)':
            'if(t.wrcadLazyDisc){t.wrcadLazyDisc.mount(o,i);return}var e=o.open(i,"a");t.isWriteEmptyRomEnabled()||o.write(e,t.romBytes,0,t.romBytes.length,0,!0),o.close(e)',
    }
    for old, new in replacements.items():
        if bundle.count(old) != 1:
            raise ValueError('PlayStation streaming hook is missing or ambiguous')
        bundle = bundle.replace(old, new, 1)
    return bundle
