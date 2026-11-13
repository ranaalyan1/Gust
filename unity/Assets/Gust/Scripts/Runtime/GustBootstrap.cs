using Gust.Core;
using UnityEngine;

namespace Gust.Runtime
{
    /// <summary>
    /// Placeholder scene builder for the native port.
    ///
    /// This exists so the project does something visible the moment it opens,
    /// and so the deterministic core is exercised on the Unity side: the same
    /// seed must always scatter the same islands. It is NOT the game — the wind
    /// field, seed physics, gestures and renderer still have to be ported (see
    /// docs/NATIVE_QUEST_PLAN.md §4).
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class GustBootstrap : MonoBehaviour
    {
        [Tooltip("World seed. The TypeScript build must scatter these islands identically for the same value.")]
        [SerializeField] private int seed = 12345;

        [Tooltip("Number of placeholder islands.")]
        [SerializeField, Range(1, 64)] private int islandCount = 9;

        [Tooltip("Radius of the tabletop diorama in metres (1:7 scale).")]
        [SerializeField] private float dioramaRadius = 0.35f;

        private readonly FixedStepper _stepper = new FixedStepper();

        private void Start()
        {
            BuildPlaceholderDiorama();
        }

        private void Update()
        {
            // Proves the fixed-timestep port runs; the real game steps its
            // physics and director here later.
            _stepper.Advance(Time.deltaTime, dt =>
            {
                // physics + weather mind go here
                _ = dt;
            });
        }

        private void BuildPlaceholderDiorama()
        {
            var rng = new Rng(seed);

            for (int i = 0; i < islandCount; i++)
            {
                float angle = (float)(rng.Next() * Mathf.PI * 2.0);
                float distance = (float)(rng.Next() * dioramaRadius);
                float height = (float)(rng.Next() * 0.12 - 0.06);
                float size = (float)(0.02 + rng.Next() * 0.035);

                var island = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                island.name = $"island-{i}";
                island.transform.SetParent(transform, false);
                island.transform.localPosition = new Vector3(
                    Mathf.Cos(angle) * distance,
                    height,
                    Mathf.Sin(angle) * distance);
                island.transform.localScale = new Vector3(size * 2f, size * 0.6f, size * 2f);

                var renderer = island.GetComponent<Renderer>();
                if (renderer != null)
                {
                    // A cheap stand-in for the generated island palette.
                    renderer.material.color = Color.Lerp(
                        new Color(0.42f, 0.55f, 0.36f),
                        new Color(0.72f, 0.66f, 0.45f),
                        (float)rng.Next());
                }
            }

            Debug.Log($"[GUST] placeholder diorama: {islandCount} islands, seed {seed}, " +
                      $"hash01(seed)={Hashing.Hash01(seed):F6}");
        }
    }
}
