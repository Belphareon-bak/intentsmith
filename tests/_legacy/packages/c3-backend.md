# Historical C3 backend integration reference

The disputed `final` commit moved a pre-existing symbolic link here from
`tests/packages/c3-backend`. The link targeted an absolute path in one
developer's separate checkout, so it was neither portable nor part of this
repository's source.

The historical intent was to reference the C3 IDE WebSocket backend sprint
integration. Gate 0 retains that intent as documentation only. No archived test
or active test registry entry depends on this path.
