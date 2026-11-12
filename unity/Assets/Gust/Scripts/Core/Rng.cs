using System;

namespace Gust.Core
{
    /// <summary>
    /// Deterministic PRNG. Port of <c>src/core/random.ts</c> (mulberry32), kept
    /// bit-for-bit with the TypeScript so a seed means the same world in both
    /// builds.
    ///
    /// The JavaScript source relies on 32-bit wrapping multiply (Math.imul) and
    /// on ToInt32 truncation (via bitwise ops). Both are reproduced here with
    /// unchecked integer arithmetic, which has identical wrap-around semantics.
    /// </summary>
    public sealed class Rng
    {
        private int _a;

        public Rng(int seed)
        {
            _a = seed;
        }

        /// <summary>Next value in [0, 1).</summary>
        public double Next()
        {
            unchecked
            {
                _a += 0x6d2b79f5;
                int t = _a;
                t = (t ^ LogicalShiftRight(t, 15)) * (t | 1);
                t ^= t + (t ^ LogicalShiftRight(t, 7)) * (t | 61);
                return (uint)(t ^ LogicalShiftRight(t, 14)) / 4294967296.0;
            }
        }

        /// <summary>Convenience: uniform value in [lo, hi).</summary>
        public double Range(double lo, double hi)
        {
            return Hashing.RangeRng(Next, lo, hi);
        }

        /// <summary>Unsigned right shift, as JavaScript's <c>&gt;&gt;&gt;</c>.</summary>
        private static int LogicalShiftRight(int value, int bits)
        {
            return (int)((uint)value >> bits);
        }
    }

    /// <summary>
    /// Stateless hashing helpers. Port of the hash functions in
    /// <c>src/core/random.ts</c>.
    /// </summary>
    public static class Hashing
    {
        /// <summary>Integer hash to [0, 1). Stateless; per-instance variation.</summary>
        public static double Hash01(int n)
        {
            // JavaScript evaluates these products as doubles and truncates to
            // int32 only at the bitwise operators. ToInt32(huge) is the value
            // modulo 2^32, which is what the (int) cast below does once the
            // double has been narrowed to long first.
            double h = (double)n * 374761393.0 + 668265263.0;
            int x = ToInt32(h);
            x ^= (int)((uint)x >> 13);
            h = (double)x * 1274126177.0;
            int y = ToInt32(h);
            y ^= (int)((uint)y >> 16);
            return (uint)y / 4294967296.0;
        }

        /// <summary>FNV-1a over UTF-16 code units, matching the TypeScript.</summary>
        public static uint HashString(string s)
        {
            unchecked
            {
                int h = (int)2166136261u;
                for (int i = 0; i < s.Length; i++)
                {
                    h ^= s[i];
                    h *= 16777619;
                }
                return (uint)h;
            }
        }

        public static double RangeRng(Func<double> rng, double lo, double hi)
        {
            return lo + (hi - lo) * rng();
        }

        /// <summary>Emulates JavaScript's ToInt32: exact value modulo 2^32.</summary>
        private static int ToInt32(double d)
        {
            unchecked
            {
                // (long) is defined for |d| well beyond the magnitudes produced
                // above; the int cast then keeps the low 32 bits.
                return (int)(long)Math.Truncate(d);
            }
        }
    }
}
