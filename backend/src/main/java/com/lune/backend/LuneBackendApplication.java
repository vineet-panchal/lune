package com.lune.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class LuneBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(LuneBackendApplication.class, args);
	}

}
