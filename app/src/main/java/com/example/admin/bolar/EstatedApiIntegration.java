package com.example.admin.bolar;

import java.net.URL;
import java.io.IOException;
import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;

public class EstatedApiIntegration {
    public static void main(String[] args) throws IOException {
        getProperties();
    }

    private static void getProperties() throws IOException {
        URL obj = new URL("https://api.estated.com/property/v3?token=YourAPIKeyGoesHere&address=1716%20S%20Heritage%20Cir&city=Anaheim&state=Ca");
        HttpURLConnection con = (HttpURLConnection) obj.openConnection();
        con.setRequestMethod("GET");

        if (con.getResponseCode() == HttpURLConnection.HTTP_OK) {
            BufferedReader in = new BufferedReader(new InputStreamReader(con.getInputStream()));

            String line;
            StringBuffer response = new StringBuffer();

            while ((line = in.readLine()) != null) {
                response.append(line);
            }

            in.close();

            System.out.println(response.toString());
        } else {
            System.out.println("GET request failed.");
        }
    }
}
