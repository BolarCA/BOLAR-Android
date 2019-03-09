package com.example.admin.bolar;

import org.json.JSONException;
import org.json.JSONObject;

public class AddressData {

    public String street_number;
    public String street_pre_direction;
    public String street_name;
    public String street_suffix;
    public String street_post_direction;
    public String unit_number;
    public String formatted_street_address;
    public String city;
    public String state;
    public String zip_code;
    public String zip_code_plus_four;

    public static AddressData fromJSON(JSONObject json) throws JSONException {
        AddressData addressData = new AddressData();

        if(!json.isNull("street_number")){
            addressData.street_number = json.getString("street_number");
        }
        if(!json.isNull("street_pre_direction")){
            addressData.street_pre_direction = json.getString("street_pre_direction");
        }
        if(!json.isNull("street_name")){
            addressData.street_name = json.getString("street_name");
        }
        if(!json.isNull("street_suffix")){
            addressData.street_suffix = json.getString("street_suffix");
        }
        if(!json.isNull("street_post_direction")){
            addressData.street_post_direction = json.getString("street_post_direction");
        }
        if(!json.isNull("unit_number")){
            addressData.unit_number = json.getString("unit_number");
        }
        if(!json.isNull("formatted_street_address")){
            addressData.formatted_street_address = json.getString("formatted_street_address");
        }
        if(!json.isNull("city")){
            addressData.city = json.getString("city");
        }
        if(!json.isNull("state")){
            addressData.state = json.getString("state");
        }
        if(!json.isNull("zip_code")){
            addressData.zip_code = json.getString("zip_code");
        }
        if(!json.isNull("zip_code_plus_four")){
            addressData.zip_code_plus_four = json.getString("zip_code_plus_four");
        }

        return addressData;
    }

}
