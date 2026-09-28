package cz.intentsmith.companion;

import java.io.ByteArrayOutputStream;

/** Canonical RFC 4648 base64url without padding, available below API 26. */
final class M7Base64Url {
    private static final char[] ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();

    private M7Base64Url() {}

    static String encode(byte[] value) {
        StringBuilder output = new StringBuilder((value.length * 4 + 2) / 3);
        for (int index = 0; index < value.length; index += 3) {
            int remaining = value.length - index;
            int bits = (value[index] & 0xff) << 16;
            if (remaining > 1) bits |= (value[index + 1] & 0xff) << 8;
            if (remaining > 2) bits |= value[index + 2] & 0xff;
            output.append(ALPHABET[(bits >>> 18) & 63]);
            output.append(ALPHABET[(bits >>> 12) & 63]);
            if (remaining > 1) output.append(ALPHABET[(bits >>> 6) & 63]);
            if (remaining > 2) output.append(ALPHABET[bits & 63]);
        }
        return output.toString();
    }

    static byte[] decode(String value) {
        if (value == null || value.length() % 4 == 1 || !value.matches("[A-Za-z0-9_-]*")) {
            throw new IllegalArgumentException("m7_base64url_invalid");
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream(value.length() * 3 / 4);
        int accumulator = 0;
        int bits = 0;
        for (int index = 0; index < value.length(); index += 1) {
            int decoded = decode(value.charAt(index));
            accumulator = (accumulator << 6) | decoded;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                output.write((accumulator >>> bits) & 0xff);
            }
        }
        if (bits > 0 && (accumulator & ((1 << bits) - 1)) != 0) {
            throw new IllegalArgumentException("m7_base64url_noncanonical");
        }
        byte[] result = output.toByteArray();
        if (!encode(result).equals(value)) throw new IllegalArgumentException("m7_base64url_noncanonical");
        return result;
    }

    private static int decode(char value) {
        if (value >= 'A' && value <= 'Z') return value - 'A';
        if (value >= 'a' && value <= 'z') return value - 'a' + 26;
        if (value >= '0' && value <= '9') return value - '0' + 52;
        if (value == '-') return 62;
        if (value == '_') return 63;
        throw new IllegalArgumentException("m7_base64url_invalid");
    }
}
