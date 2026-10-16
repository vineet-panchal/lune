# Build stage: compile the Spring Boot jar with the Maven wrapper.
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -B -q dependency:go-offline
COPY src src
RUN ./mvnw -B -q package -DskipTests

# Run stage: just the JRE and the jar.
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
# Every cache path defaults to ${user.home}/.lune, so pointing user.home at /data
# puts the TLE cache, TLE history and feed cache on the mounted volume.
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec java -XX:MaxRAMPercentage=75 -Duser.home=/data $JAVA_OPTS -jar app.jar"]
