# Bridle Agent Client (Runtime)

This is a reference copy. The production version lives in the [CleanSlice Runtime](https://github.com/CleanSlice/runtime) repo at:

```
runtime/src/slices/setup/channel/data/repositories/bridle/bridle.repository.ts
```

The runtime version imports from the channel domain (`IChannelGateway`, `Message`, `buildMessage`) and converts between wire `BridlePart[]` and runtime `MessagePart[]`. This standalone copy keeps bridle self-contained with its own interfaces.

## When to use which

| Version | Use when |
|---------|----------|
| `runtime/` (this folder) | Integrating bridle into a non-CleanSlice project |
| Runtime repo copy | Already using the CleanSlice runtime with the channel system |

## Protocol

See [PROTOCOL.md](../docs/PROTOCOL.md) for the wire format, event schemas, and streaming model.
