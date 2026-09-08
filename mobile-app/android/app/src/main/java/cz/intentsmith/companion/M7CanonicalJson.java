package cz.intentsmith.companion;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** Exact UTF-8/NFC/safe-integer JSON used by the M7 signed wire contract. */
final class M7CanonicalJson {
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    private M7CanonicalJson() {}

    static String encode(Object value) throws Exception {
        StringBuilder output = new StringBuilder();
        append(value, output, 0);
        return output.toString();
    }

    static byte[] bytes(Object value) throws Exception {
        return encode(value).getBytes(StandardCharsets.UTF_8);
    }

    private static void append(Object value, StringBuilder output, int depth) throws Exception {
        if (depth > 32) throw new IllegalArgumentException("m7_canonical_too_deep");
        if (value == null || value == JSONObject.NULL) {
            output.append("null");
            return;
        }
        if (value instanceof String) {
            quote(Normalizer.normalize((String) value, Normalizer.Form.NFC), output);
            return;
        }
        if (value instanceof Boolean) {
            output.append(((Boolean) value) ? "true" : "false");
            return;
        }
        if (value instanceof Number) {
            double observed = ((Number) value).doubleValue();
            if (!Double.isFinite(observed) || observed != Math.rint(observed)
                || Math.abs(observed) > MAX_SAFE_INTEGER
                || Double.doubleToRawLongBits(observed) == Double.doubleToRawLongBits(-0.0d)) {
                throw new IllegalArgumentException("m7_canonical_invalid_number");
            }
            output.append(Long.toString((long) observed));
            return;
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            output.append('[');
            for (int index = 0; index < array.length(); index += 1) {
                if (index > 0) output.append(',');
                append(array.get(index), output, depth + 1);
            }
            output.append(']');
            return;
        }
        if (value instanceof JSONObject) {
            appendObject((JSONObject) value, output, depth);
            return;
        }
        throw new IllegalArgumentException("m7_canonical_unsupported_value");
    }

    private static void appendObject(JSONObject object, StringBuilder output, int depth) throws Exception {
        List<Key> keys = new ArrayList<>();
        Set<String> normalized = new HashSet<>();
        Iterator<String> iterator = object.keys();
        while (iterator.hasNext()) {
            String original = iterator.next();
            String canonical = Normalizer.normalize(original, Normalizer.Form.NFC);
            if (!normalized.add(canonical)) {
                throw new IllegalArgumentException("m7_canonical_key_collision");
            }
            keys.add(new Key(original, canonical));
        }
        Collections.sort(keys, Comparator.comparing(key -> key.utf8, M7CanonicalJson::compareBytes));
        output.append('{');
        for (int index = 0; index < keys.size(); index += 1) {
            if (index > 0) output.append(',');
            Key key = keys.get(index);
            quote(key.normalized, output);
            output.append(':');
            append(object.get(key.original), output, depth + 1);
        }
        output.append('}');
    }

    private static int compareBytes(byte[] left, byte[] right) {
        int length = Math.min(left.length, right.length);
        for (int index = 0; index < length; index += 1) {
            int a = left[index] & 0xff;
            int b = right[index] & 0xff;
            if (a != b) return Integer.compare(a, b);
        }
        return Integer.compare(left.length, right.length);
    }

    private static void quote(String value, StringBuilder output) {
        output.append('"');
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            switch (character) {
                case '"': output.append("\\\""); break;
                case '\\': output.append("\\\\"); break;
                case '\b': output.append("\\b"); break;
                case '\f': output.append("\\f"); break;
                case '\n': output.append("\\n"); break;
                case '\r': output.append("\\r"); break;
                case '\t': output.append("\\t"); break;
                default:
                    if (character <= 0x1f) {
                        output.append(String.format("\\u%04x", (int) character));
                    } else if (Character.isHighSurrogate(character)) {
                        if (index + 1 < value.length() && Character.isLowSurrogate(value.charAt(index + 1))) {
                            output.append(character).append(value.charAt(index + 1));
                            index += 1;
                        } else {
                            output.append(String.format("\\u%04x", (int) character));
                        }
                    } else if (Character.isLowSurrogate(character)) {
                        output.append(String.format("\\u%04x", (int) character));
                    } else {
                        output.append(character);
                    }
            }
        }
        output.append('"');
    }

    private static final class Key {
        final String original;
        final String normalized;
        final byte[] utf8;

        Key(String original, String normalized) {
            this.original = original;
            this.normalized = normalized;
            this.utf8 = normalized.getBytes(StandardCharsets.UTF_8);
        }
    }
}
