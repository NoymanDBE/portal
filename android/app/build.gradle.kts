plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dror.portal"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dror.portal"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        create("stable") {
            // Generated once by CI and committed to this private repo so every
            // build carries the same signature and updates install in place.
            storeFile = rootProject.file("keystore.jks")
            storePassword = "portal-debug"
            keyAlias = "portal"
            keyPassword = "portal-debug"
        }
    }
    buildTypes {
        getByName("debug") {
            if (rootProject.file("keystore.jks").exists()) {
                signingConfig = signingConfigs.getByName("stable")
            }
        }
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
