# Builds the Reelstr Android debug APK in a container, so the host needs only Docker.
#   docker build -t reelstr-android infra/android
#   docker run --rm --cpus 1 --memory 5g -v "$PWD:/src:ro" -v "$PWD/out:/out" reelstr-android
FROM eclipse-temurin:21-jdk-noble
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip git ca-certificates rsync \
  && rm -rf /var/lib/apt/lists/*
ENV ANDROID_HOME=/opt/android-sdk
RUN mkdir -p $ANDROID_HOME/cmdline-tools && cd /tmp \
  && curl -fsSL -o t.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
  && unzip -q t.zip && mv cmdline-tools $ANDROID_HOME/cmdline-tools/latest && rm t.zip
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:/root/.bun/bin
RUN yes | sdkmanager --licenses >/dev/null \
  && sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
RUN curl -fsSL https://bun.sh/install | bash
COPY build.sh /build.sh
CMD ["bash", "/build.sh"]
