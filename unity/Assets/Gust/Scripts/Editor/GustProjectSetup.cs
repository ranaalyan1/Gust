using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Gust.Editor
{
    /// <summary>
    /// One-click project setup. Generates the main scene rather than committing
    /// a hand-written .unity YAML file, so the scene is always valid for the
    /// Unity version that opens the project.
    ///
    /// Menu: GUST ▸ Setup ▸ ...
    /// </summary>
    public static class GustProjectSetup
    {
        private const string SceneFolder = "Assets/Gust/Scenes";
        private const string ScenePath = SceneFolder + "/Main.unity";
        private const string AndroidPackage = "com.ranaalyan.gust";

        [MenuItem("GUST/Setup/Create Main Scene", priority = 10)]
        public static void CreateMainScene()
        {
            Directory.CreateDirectory(SceneFolder);

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            // Diorama root
            var root = new GameObject("GUST");
            root.AddComponent<Gust.Runtime.GustBootstrap>();

            // Tabletop viewing position: seated, looking down at a 1:7 diorama.
            var camera = Camera.main;
            if (camera != null)
            {
                camera.transform.position = new Vector3(0f, 1.35f, 0.55f);
                camera.transform.rotation = Quaternion.Euler(24f, 180f, 0f);
                camera.clearFlags = CameraClearFlags.Skybox;
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);

            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(ScenePath, true),
            };

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log($"[GUST] created {ScenePath} and set it as the only build scene.");
        }

        [MenuItem("GUST/Setup/Configure for Quest", priority = 20)]
        public static void ConfigureForQuest()
        {
            PlayerSettings.companyName = "GUST";
            PlayerSettings.productName = "GUST";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, AndroidPackage);

            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel32;
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.SetIl2CppCompilerConfiguration(NamedBuildTarget.Android, Il2CppCompilerConfiguration.Release);

            EditorUserBuildSettings.androidBuildSubtarget = MobileTextureSubtarget.ASTC;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            // XR is driven by the OpenXR plug-in, not the legacy "Virtual Reality Supported" flag.

            Debug.Log("[GUST] player settings set for Quest: Android, IL2CPP, ARM64, min SDK 32, ASTC. " +
                      "Now add the Meta XR All-in-One SDK and enable OpenXR (see unity/README.md).");
        }

        [MenuItem("GUST/Setup/Open Readme", priority = 30)]
        public static void OpenReadme()
        {
            var readme = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Gust/README.txt");
            if (readme != null)
            {
                AssetDatabase.OpenAsset(readme);
            }
            else
            {
                Debug.Log("[GUST] setup instructions live in unity/README.md in the repository root.");
            }
        }
    }
}
